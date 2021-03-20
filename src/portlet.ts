import { getPref, setDefaultConfig } from './Config';

/**
 * Set portlet configurations, which are skin-specific
 * XXX: move to Config.ts and avoid the function
 */
export function setPortletConfig() {
	// Some skin dependent config.
	switch (mw.config.get('skin')) {
		case 'vector':
			setDefaultConfig([
				{ name: 'portletArea', value: 'right-navigation' },
				{ name: 'portletId', value: 'p-twinkle' },
				{ name: 'portletName', value: 'TW' },
				{ name: 'portletType', value: 'menu' },
				{ name: 'portletNext', value: 'p-search' },
			]);
			break;
		case 'timeless':
			setDefaultConfig([
				{ name: 'portletArea', value: '#page-tools .sidebar-inner' },
				{ name: 'portletId', value: 'p-twinkle' },
				{ name: 'portletName', value: 'Twinkle' },
				{ name: 'portletType', value: null },
				{ name: 'portletNext', value: 'p-userpagetools' },
			]);
			break;
		default:
			setDefaultConfig([
				{ name: 'portletArea', value: null },
				{ name: 'portletId', value: 'p-cactions' },
				{ name: 'portletName', value: null },
				{ name: 'portletType', value: null },
				{ name: 'portletNext', value: null },
			]);
	}
}

/**
 * Builds a portlet menu if it doesn't exist yet, and add the portlet link.
 * @param task: Either a URL for the portlet link or a function to execute.
 * @param text
 * @param id
 * @param tooltip
 */
export function addPortletLink(task: string | (() => void), text: string, id: string, tooltip: string): HTMLLIElement {
	if (getPref('portletArea') !== null) {
		addPortlet(
			getPref('portletArea'),
			getPref('portletId'),
			getPref('portletName'),
			getPref('portletType'),
			getPref('portletNext')
		);
	}
	let link = mw.util.addPortletLink(getPref('portletId'), typeof task === 'string' ? task : '#', text, id, tooltip);
	$('.client-js .skin-vector #p-cactions').css('margin-right', 'initial');
	if (typeof task === 'function') {
		$(link).click(function (ev) {
			task();
			ev.preventDefault();
		});
	}
	if ($.collapsibleTabs) {
		$.collapsibleTabs.handleResize();
	}
	return link;
}

/**
 * Adds a portlet menu to one of the navigation areas on the page.
 * This is necessarily quite a hack since skins, navigation areas, and
 * portlet menu types all work slightly different.
 *
 * Available navigation areas depend on the skin used.
 * Vector:
 *  For each option, the outer nav class contains "vector-menu", the inner div class is "vector-menu-content", and the ul is "vector-menu-content-list"
 *  "mw-panel", outer nav class contains "vector-menu-portal". Existing portlets/elements: "p-logo", "p-navigation", "p-interaction", "p-tb", "p-coll-print_export"
 *  "left-navigation", outer nav class contains "vector-menu-tabs" or "vector-menu-dropdown". Existing portlets: "p-namespaces", "p-variants" (menu)
 *  "right-navigation", outer nav class contains "vector-menu-tabs" or "vector-menu-dropdown". Existing portlets: "p-views", "p-cactions" (menu), "p-search"
 *  Special layout of p-personal portlet (part of "head") through specialized styles.
 * Monobook:
 *  "column-one", outer nav class "portlet", inner div class "pBody". Existing portlets: "p-cactions", "p-personal", "p-logo", "p-navigation", "p-search", "p-interaction", "p-tb", "p-coll-print_export"
 *  Special layout of p-cactions and p-personal through specialized styles.
 * Modern:
 *  "mw_contentwrapper" (top nav), outer nav class "portlet", inner div class "pBody". Existing portlets or elements: "p-cactions", "mw_content"
 *  "mw_portlets" (sidebar), outer nav class "portlet", inner div class "pBody". Existing portlets: "p-navigation", "p-search", "p-interaction", "p-tb", "p-coll-print_export"
 *
 * @param navigation - id of the target navigation area (skin dependant, on vector either of "left-navigation", "right-navigation", or "mw-panel")
 * @param id - id of the portlet menu to create, preferably start with "p-".
 * @param text - name of the portlet menu to create. Visibility depends on the class used.
 * @param type - type of portlet. Currently only used for the vector non-sidebar portlets, pass "menu" to make this portlet a drop down menu.
 * @param nextnodeid - the id of the node before which the new item should be added, should be another item in the same list, or undefined to place it at the end.
 *
 * @returns the DOM node of the new item (a DIV element) or null
 */
function addPortlet(navigation: string, id: string, text: string, type: string, nextnodeid: string): HTMLElement {
	// sanity checks, and get required DOM nodes
	let root = document.getElementById(navigation) || document.querySelector(navigation);
	if (!root) {
		return null;
	}

	let item = document.getElementById(id);
	if (item) {
		if (item.parentNode && item.parentNode === root) {
			return item;
		}
		return null;
	}

	let nextnode;
	if (nextnodeid) {
		nextnode = document.getElementById(nextnodeid);
	}

	// verify/normalize input
	let skin = mw.config.get('skin');
	if (skin !== 'vector' || (navigation !== 'left-navigation' && navigation !== 'right-navigation')) {
		type = null; // menu supported only in vector's #left-navigation & #right-navigation
	}
	let outerNavClass, innerDivClass;
	switch (skin) {
		case 'vector':
			// XXX: portal doesn't work
			if (navigation !== 'portal' && navigation !== 'left-navigation' && navigation !== 'right-navigation') {
				navigation = 'mw-panel';
			}
			outerNavClass =
				'vector-menu vector-menu-' + (navigation === 'mw-panel' ? 'portal' : type === 'menu' ? 'dropdown' : 'tabs');
			innerDivClass = 'vector-menu-content';
			break;
		case 'modern':
			if (navigation !== 'mw_portlets' && navigation !== 'mw_contentwrapper') {
				navigation = 'mw_portlets';
			}
			outerNavClass = 'portlet';
			break;
		case 'timeless':
			outerNavClass = 'mw-portlet';
			innerDivClass = 'mw-portlet-body';
			break;
		default:
			navigation = 'column-one';
			outerNavClass = 'portlet';
			break;
	}

	// Build the DOM elements.
	let outerNav = document.createElement('nav');
	outerNav.setAttribute('aria-labelledby', id + '-label');
	outerNav.className = outerNavClass + ' emptyPortlet';
	outerNav.id = id;
	if (nextnode && nextnode.parentNode === root) {
		root.insertBefore(outerNav, nextnode);
	} else {
		root.appendChild(outerNav);
	}

	let h3 = document.createElement('h3');
	h3.id = id + '-label';
	let ul = document.createElement('ul');

	if (skin === 'vector') {
		ul.className = 'vector-menu-content-list';

		// add invisible checkbox to keep menu open when clicked
		// similar to the p-cactions ("More") menu
		if (outerNavClass.indexOf('vector-menu-dropdown') !== -1) {
			let chkbox = document.createElement('input');
			chkbox.className = 'vector-menu-checkbox';
			chkbox.setAttribute('type', 'checkbox');
			chkbox.setAttribute('aria-labelledby', id + '-label');
			outerNav.appendChild(chkbox);

			// Vector gets its title in a span; all others except
			// timeless have no title, and it has no span
			let span = document.createElement('span');
			span.appendChild(document.createTextNode(text));
			h3.appendChild(span);

			let a = document.createElement('a');
			a.href = '#';

			$(a).click(function (e) {
				e.preventDefault();
			});

			h3.appendChild(a);
		}
	} else {
		// Basically just Timeless
		h3.appendChild(document.createTextNode(text));
	}

	outerNav.appendChild(h3);

	if (innerDivClass) {
		let innerDiv = document.createElement('div');
		innerDiv.className = innerDivClass;
		innerDiv.appendChild(ul);
		outerNav.appendChild(innerDiv);
	} else {
		outerNav.appendChild(ul);
	}
	return outerNav;
}
