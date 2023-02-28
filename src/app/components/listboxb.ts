/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { defineComponent } from 'vue';

export default defineComponent({
	props: {
		/** Item entries displayed in the list. */
		'items': Array,

		/** Reactive selection controller. */
		'selection': Object,

		/** If set, only one entry can be selected. */
		'single': Boolean,

		/** If true, listbox registers for keyboard input. */
		'keyinput': Boolean
	},

	/**
	 * Reactive instance data.
	 */
	data: function() {
		return {
			scroll: 0,
			scrollRel: 0,
			isScrolling: false,
			slotCount: 1,
			lastSelectItem: null
		};
	},

	computed: {
		/**
		 * Offset of the scroll widget in pixels.
		 * Between 0 and the height of the component.
		 */
		scrollOffset: function(): string {
			return (this.scroll) + 'px';
		},

		/**
		 * Index which array reading should start at, based on the current
		 * relative scroll and the overal item count. Value is dynamically
		 * capped based on slot count to prevent empty slots appearing.
		 */
		scrollIndex: function(): number {
			return Math.round((this.items.length - this.slotCount) * this.scrollRel);
		},

		/**
		 * Dynamic array of items which should be displayed from the underlying
		 * data array. Reactively updates based on scroll and data.
		 */
		displayItems: function(): Array<string> {
			return this.items.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		/**
		 * Weight (0-1) of a single item.
		 */
		itemWeight: function(): number {
			return 1 / this.items.length;
		}
	},

	/**
	 * Invoked when the component is mounted.
	 * Used to register global listeners and resize observer.
	 */
	mounted: function(): void {
		this.onMouseMove = (e: MouseEvent): void => this.moveMouse(e);
		this.onMouseUp = (e: MouseEvent): void => this.stopMouse(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		if (this.keyinput) {
			this.onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);
			document.addEventListener('keydown', this.onKeyDown);
		}

		// Register observer for layout changes.
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.$el);
	},

	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners and resize observer.
	 */
	beforeUnmount: function(): void {
		// Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		if (this.keyinput)
			document.removeEventListener('keydown', this.onKeyDown);

		// Disconnect resize observer.
		this.observer.disconnect();
	},

	methods: {
		/**
		 * Invoked by a ResizeObserver when the main component node
		 * is resized due to layout changes.
		 */
		resize: function(): void {
			if (this.$refs.scroller && this.$el) {
				this.scroll = (this.$el.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
				this.slotCount = Math.floor(this.$el.clientHeight / 26);
			}
		},

		/**
		 * Restricts the scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the scroll.
		 */
		recalculateBounds: function(): void {
			const max = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
			this.scroll = Math.min(max, Math.max(0, this.scroll));
			this.scrollRel = this.scroll / max;
		},

		/**
		 * Invoked when a mouse-down event is captured on the scroll widget.
		 * @param event
		 */
		startMouse: function(event: MouseEvent): void {
			this.scrollStartY = event.clientY;
			this.scrollStart = this.scroll;
			this.isScrolling = true;
		},

		/**
		 * Invoked when a mouse-move event is captured globally.
		 * @param event
		 */
		moveMouse: function(event: MouseEvent): void {
			if (this.isScrolling) {
				this.scroll = this.scrollStart + (event.clientY - this.scrollStartY);
				this.recalculateBounds();
			}
		},

		/**Invoked when a mouse-up event is captured globally. */
		stopMouse: function(): void {
			this.isScrolling = false;
		},

		/**
		 * Invoked when a mouse-wheel event is captured on the component node.
		 * @param event
		 */
		wheelMouse: function(event: WheelEvent): void {
			const weight = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
			const child = this.$el.querySelector('.item');

			if (child !== null) {
				const scrollCount = Math.floor(this.$el.clientHeight / child.clientHeight);
				const direction = event.deltaY > 0 ? 1 : -1;
				this.scroll += ((scrollCount * this.itemWeight) * weight) * direction;
				this.recalculateBounds();
			}
		},

		/**
		 * Invoked when a keydown event is fired.
		 * @param event
		 */
		handleKey: function(event: KeyboardEvent): void {
			// If document.activeElement is the document body, then we can safely assume
			// the user is not focusing anything, and can intercept keyboard input.
			if (document.activeElement !== document.body)
				return;

			// User hasn't selected anything in the listbox yet.
			if (!this.lastSelectItem)
				return;

			if (event.key === 'c' && event.ctrlKey) {
				// Copy selection to clipboard.
				nw.Clipboard.get().set(this.selection.join('\n'), 'text');
			} else {
				// Arrow keys.
				const isArrowUp = event.key === 'ArrowUp';
				const isArrowDown = event.key === 'ArrowDown';
				if (isArrowUp || isArrowDown) {
					const delta = isArrowUp ? -1 : 1;

					// Move/expand selection one.
					const lastSelectIndex = this.items.indexOf(this.lastSelectItem);
					const nextIndex = lastSelectIndex + delta;
					const next = this.items[nextIndex];
					if (next) {
						const lastViewIndex = isArrowUp ? this.scrollIndex : this.scrollIndex + this.slotCount;
						let diff = Math.abs(nextIndex - lastViewIndex);
						if (isArrowDown)
							diff += 1;

						if ((isArrowUp && nextIndex < lastViewIndex) || (isArrowDown && nextIndex >= lastViewIndex)) {
							const weight = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
							this.scroll += ((diff * this.itemWeight) * weight) * delta;
							this.recalculateBounds();
						}

						if (!event.shiftKey || this.single)
							this.selection.splice(0);

						this.selection.push(next);
						this.lastSelectItem = next;
					}
				}
			}
		},

		/**
		 * Invoked when a user selects an item in the list.
		 * @param item
		 * @param event
		 */
		selectItem: function(item: string, event: MouseEvent): void {
			const checkIndex = this.selection.indexOf(item);

			if (this.single) {
				// Listbox is in single-entry mode, replace selection.
				if (checkIndex === -1) {
					this.selection.splice(0);
					this.selection.push(item);
				}

				this.lastSelectItem = item;
			} else {
				if (event.ctrlKey) {
					// Ctrl-key held, so allow multiple selections.
					if (checkIndex > -1)
						this.selection.splice(checkIndex, 1);
					else
						this.selection.push(item);
				} else if (event.shiftKey) {
					// Shift-key held, select a range.
					if (this.lastSelectItem && this.lastSelectItem !== item) {
						const lastSelectIndex = this.items.indexOf(this.lastSelectItem);
						const thisSelectIndex = this.items.indexOf(item);

						const delta = Math.abs(lastSelectIndex - thisSelectIndex);
						const lowest = Math.min(lastSelectIndex, thisSelectIndex);
						const range = this.items.slice(lowest, lowest + delta + 1);

						for (const select of range) {
							if (this.selection.indexOf(select) === -1)
								this.selection.push(select);
						}
					}
				} else if (checkIndex === -1 || (checkIndex > -1 && this.selection.length > 1)) {
					// Normal click, replace entire selection.
					this.selection.splice(0);
					this.selection.push(item);
				}

				this.lastSelectItem = item;
			}
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-listbox" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="(item, i) in displayItems" class="item" @click="selectItem(item, $event)" :class="{ selected: selection.includes(item) }">
			<span class="sub sub-0">{{ item.label }}</span>
		</div>
	</div>`
});