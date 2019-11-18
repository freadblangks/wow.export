const util = require('util');
const path = require('path');
const constants = require('../constants');
const generics = require('../generics');
const core = require('../core');
const log = require('../log');
const CASC = require('./casc-source');
const VersionConfig = require('./version-config');
const CDNConfig = require('./cdn-config');
const listfile = require('./listfile');
const BufferWrapper = require('../buffer');

class CASCRemote extends CASC {
	/**
	 * Create a new CASC source using a Blizzard CDN.
	 * @param {string} region Region tag (eu, us, etc).
	 */
	constructor(region) {
		super();

		this.region = region;
	}

	/**
	 * Initialize remote CASC source.
	 */
	async init() {
		log.write('Initializing remote CASC source (%s)', this.region);
		this.host = util.format(constants.PATCH.HOST, this.region);
		this.builds = [];

		// Collect version configs for all products.
		const promises = Object.keys(constants.PRODUCTS).map(p => this.getVersionConfig(p));
		const results = await Promise.allSettled(promises);

		// Iterate through successful requests and extract product config for our region.
		for (const result of results)
			if (result.status === 'fulfilled')
				this.builds.push(result.value.find(e => e.Region === this.region));

		log.write('%o', this.builds);
	}

	/**
	 * Download the remote version config for a specific product.
	 * @param {string} product 
	 */
	async getVersionConfig(product) {
		const config = await this.getConfig(product, constants.PATCH.VERSION_CONFIG);
		config.forEach(entry => entry.Product = product);
		return config;
	}

	/**
	 * Download and parse a version config file.
	 * @param {string} product 
	 * @param {string} file 
	 */
	async getConfig(product, file) {
		const url = this.host + product + file;
		const res = await generics.get(url);

		if (res.statusCode !== 200)
			throw new Error(util.format('HTTP %d from remote CASC endpoint: %s', res.statusCode, url));

		return VersionConfig(await generics.consumeUTF8Stream(res));
	}

	/**
	 * Download and parse a CDN config file.
	 * @param {string} key 
	 */
	async getCDNConfig(key) {
		const url = this.host + 'config/' + this.formatCDNKey(key);
		const res = await generics.get(url);

		if (res.statusCode !== 200)
			throw new Error(util.format('Unable to retrieve CDN config file %s (HTTP %d)', key, res.statusCode));

		return CDNConfig(await generics.consumeUTF8Stream(res));
	}

	/**
	 * Returns a list of available products on the remote CDN.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList() {
		const products = [];
		for (const entry of this.builds)
			products.push(util.format('%s %s', constants.PRODUCTS[entry.Product], entry.VersionsName));

		return products;
	}

	/**
	 * Load the CASC interface with the given build.
	 * @param {number} buildIndex
	 */
	async load(buildIndex) {
		this.build = this.builds[buildIndex];
		log.write('Loading remote CASC build: %o', this.build);

		this.progress = core.createProgress(9);
		await this.loadServerConfig();
		await this.resolveCDNHost();
		await this.loadConfigs();
		await this.loadArchives();
		await this.loadEncoding();
		await this.loadRoot();
		await this.loadListfile();
	}

	/**
	 * Load the listfile for selected build.
	 */
	async loadListfile() {
		await this.progress.step('Loading listfile');
		const entries = await listfile.loadListfile(this.build.BuildConfig);
		if (entries === 0)
			throw new Error('No listfile entries found');
	}

	/**
	 * Download and parse the encoding file.
	 */
	async loadEncoding() {
		// Download encoding file.
		log.timeLog();
		const encKeys = this.buildConfig.encoding.split(' ');
		const cdnKey = this.formatCDNKey(encKeys[1]);

		await this.progress.step('Fetching encoding table');
		const encRaw = await this.getDataFile(cdnKey);
		log.timeEnd('Downloaded encoding table (%s)', generics.filesize(encRaw.byteLength));

		// Parse encoding file.
		log.timeLog();
		await this.progress.step('Parsing encoding table');
		await this.parseEncodingFile(encRaw, encKeys[1]);
		log.timeEnd('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	/**
	 * Download and parse the root file.
	 */
	async loadRoot() {
		// Get root key from encoding table.
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		// Download root file.
		log.timeLog();
		await this.progress.step('Fetching root file');
		const urlKey = this.formatCDNKey(rootKey);
		const root = await this.getDataFile(urlKey);
		log.timeEnd('Downloaded root file (%s)', generics.filesize(root.byteLength));

		// Parse root file.
		log.timeLog();
		await this.progress.step('Parsing root file');
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		log.timeEnd('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	/**
	 * Download and parse archive files.
	 */
	async loadArchives() {
		// Download archive indexes.
		const archiveKeys = this.cdnConfig.archives.split(' ');
		const archiveCount = archiveKeys.length;
		let archiveEntryCount = 0;

		log.timeLog();

		await this.progress.step('Fetching archives');
		await generics.queue(archiveKeys, async (key) => {
			const entries = await this.getArchiveIndex(key);
			archiveEntryCount += entries.length;

			this.archives.set(key, entries);
		}, 50);

		// Quick and dirty way to get the total archive size using config.
		let archiveTotalSize = this.cdnConfig.archivesIndexSize.split(' ').reduce((x, e) => Number(x) + Number(e));
		log.timeEnd('Downloaded %d archives (%d entries, %s)', archiveCount, archiveEntryCount, generics.filesize(archiveTotalSize));
	}

	/**
	 * Download the CDN configuration and store the entry for our
	 * selected region.
	 */
	async loadServerConfig() {
		// Download CDN server list.
		await this.progress.step('Fetching CDN configuration');
		const serverConfigs = await this.getConfig(this.build.Product, constants.PATCH.SERVER_CONFIG);
		log.write('%o', serverConfigs);

		// Locate the CDN entry for our selected region.
		this.serverConfig = serverConfigs.find(e => e.Name === this.region);
		if (!this.serverConfig)
			throw new Error('CDN config does not contain entry for region ' + this.region);
	}

	/**
	 * Load and parse the contents of an archive index.
	 * Will use global cache and download if missing.
	 * @param {string} key 
	 */
	async getArchiveIndex(key) {
		const cdnKey = this.formatCDNKey(key) + '.index';
		const cachePath = path.join(constants.CACHE.ARCHIVE_INDEXES, key + '.index');

		let data;
		try {
			// Read the file from cache.
			data = await BufferWrapper.readFile(cachePath);
		} catch (e) {
			// Not cached, download and store.
			data = await this.getDataFile(cdnKey);
			await data.writeToFile(cachePath);
		}
		
		return this.parseArchiveIndex(data);
	}

	/**
	 * Download a data file from the CDN.
	 * @param {string} file 
	 * @returns {BufferWrapper}
	 */
	async getDataFile(file) {
		return await generics.downloadFile(this.host + 'data/' + file);
	}

	/**
	 * Download the CDNConfig and BuildConfig.
	 */
	async loadConfigs() {
		// Download CDNConfig and BuildConfig.
		await this.progress.step('Fetching build configurations');
		this.cdnConfig = await this.getCDNConfig(this.build.CDNConfig);
		this.buildConfig = await this.getCDNConfig(this.build.BuildConfig);

		log.write('CDNConfig: %o', this.cdnConfig);
		log.write('BuildConfig: %o', this.buildConfig);
	}

	/**
	 * Run a ping for all hosts in the server config and resolve fastest.
	 * Returns NULL if all the hosts failed to ping.
	 */
	async resolveCDNHost() {
		await this.progress.step('Locating fastest CDN server');
		log.write('Resolving best host: %s', this.serverConfig.Hosts);

		let bestHost = null;
		const hosts = this.serverConfig.Hosts.split(' ').map(e => 'http://' + e + '/');
		const hostPings = [];

		for (const host of hosts) {
			hostPings.push(generics.ping(host).then(ping => {
				log.write('Host %s resolved with %dms ping', host, ping);
				if (bestHost === null || ping < bestHost.ping)
					bestHost = { host, ping };
			}).catch(e => {
				log.write('Host %s failed to resolve a ping: %s', host, e);
			}));
		}

		// Ensure that every ping has resolved or failed.
		await Promise.allSettled(hostPings);

		// No hosts resolved.
		if (bestHost === null)
			throw new Error('Unable to resolve a CDN host.');

		log.write('%s resolved as the fastest host with a ping of %dms', bestHost.host, bestHost.ping);
		this.host = bestHost.host + this.serverConfig.Path + '/';
	}

	/**
	 * Format a CDN key for use in CDN requests.
	 * 49299eae4e3a195953764bb4adb3c91f -> 49/29/49299eae4e3a195953764bb4adb3c91f
	 * @param {string} key 
	 */
	formatCDNKey(key) {
		return key.substring(0, 2) + '/' + key.substring(2, 4) + '/' + key;
	}
}

module.exports = CASCRemote;