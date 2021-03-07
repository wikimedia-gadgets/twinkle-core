import { arr_includes } from './utils';
import { loadMessages } from './messenger';
import messages from './messages.json';
import { Config, configPreference } from './Config';

/**
 * Defined as a namespace: anything that's exported from here (such as
 * addInitCallback) is accessible from outside (as Twinkle.addInitCallback)
 * Other items (like initCallbacks) can only be accessed from within here
 * TODO: Convert this to a class? Namespace is unconventional
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Twinkle {
	/**
	 * Localised script name
	 */
	export let scriptName = 'Twinkle';

	/**
	 * User agent
	 * @see https://meta.wikimedia.org/wiki/User-Agent_policy
	 */
	export let userAgent = 'Twinkle (' + mw.config.get('wgWikiID') + ')';

	/**
	 * Custom change tag(s) to be applied to all Twinkle actions, create at [[Special:Tags]]
	 * Use of changeTags is recommended over summaryAd as it enables better usage tracking,
	 * however summaryAd is set by default as it doesn't require creation of a tag
	 */
	export let changeTags = '';

	/**
	 * Text appended to all edit summaries and log summaries for Twinkle actions. This is automatically
	 * used by Twinkle.page if changeTags isn't specified above. This may also be used manually
	 * for any actions that don't support use of change tags.
	 *
	 * You'd want to override this, providing a link to the local project page
	 * about Twinkle.
	 */
	export let summaryAd = ` (${scriptName})`;

	/**
	 * List of special pages where Twinkle is active.
	 */
	export let activeSpecialPages = ['Block', 'Contributions', 'Recentchanges', 'Recentchangeslinked'].concat(
		Morebits.userIsSysop ? ['DeletedContributions', 'Prefixindex'] : []
	);

	// TODO: config and prefs setup needs proper thought
	/**
	 * This holds the default set of preferences used by Twinkle.
	 * It is important that all new preferences added here, especially admin-only ones, are also added to
	 * |Twinkle.config.sections| in twinkleconfig.js, so they are configurable via the Twinkle preferences panel.
	 * For help on the actual preferences, see the comments in twinkleconfig.js.
	 */
	export const defaultConfig = {
		optionsVersion: 2,

		// General
		userTalkPageMode: 'tab',
		dialogLargeFont: false,
		disabledModules: [],
		disabledSysopModules: [],

		// Portlet
		portletArea: null,
		portletId: null,
		portletName: null,
		portletType: null,
		portletNext: null,

		// XfD
		logXfdNominations: false,
		xfdLogPageName: 'XfD log',
		noLogOnXfdNomination: [],
		xfdWatchDiscussion: 'default',
		xfdWatchList: 'no',
		xfdWatchPage: 'default',
		xfdWatchUser: 'default',
		xfdWatchRelated: 'default',
		markXfdPagesAsPatrolled: true,

		// Fluff (revert and rollback)
		autoMenuAfterRollback: false,
		openTalkPage: [ 'agf', 'norm', 'vand' ],
		openTalkPageOnAutoRevert: false,
		rollbackInPlace: false,
		markRevertedPagesAsMinor: [ 'vand' ],
		watchRevertedPages: [ 'agf', 'norm', 'vand', 'torev' ],
		watchRevertedExpiry: '1 month',
		offerReasonOnNormalRevert: true,
		confirmOnFluff: false,
		confirmOnMobileFluff: true,
		showRollbackLinks: [ 'diff', 'others' ],

		// CSD
		speedySelectionStyle: 'buttonClick',
		watchSpeedyPages: [ 'g3', 'g5', 'g10', 'g11', 'g12' ],
		watchSpeedyExpiry: '1 month',
		markSpeedyPagesAsPatrolled: false,

		// Warn
		defaultWarningGroup: '1',
		combinedSingletMenus: false,
		showSharedIPNotice: true,
		watchWarnings: '1 month',
		oldSelect: false,
		customWarningList: [],

		// Hidden preferences
		autolevelStaleDays: 3, // Huggle is 3, CBNG is 2
		revertMaxRevisions: 50, // intentionally limited
		batchMax: 5000,
		batchChunks: 50,

		// Deprecated options, as a fallback for add-on scripts/modules
		summaryAd: ' ([[WP:TW|TW]])',
		deletionSummaryAd: ' ([[WP:TW|TW]])',
		protectionSummaryAd: ' ([[WP:TW|TW]])',
	};

	export let prefs: typeof defaultConfig;

	export function getPref(name: string): any {
		if (typeof Twinkle.prefs === 'object' && Twinkle.prefs[name] !== undefined) {
			return Twinkle.prefs[name];
		}
		// Old preferences format, used before twinkleoptions.js was a thing
		if (typeof window.TwinkleConfig === 'object' && window.TwinkleConfig[name] !== undefined) {
			return window.TwinkleConfig[name];
		}
		if (typeof window.FriendlyConfig === 'object' && window.FriendlyConfig[name] !== undefined) {
			return window.FriendlyConfig[name];
		}
		return defaultConfig[name];
	}

	/**
	 * Extends the defaultConfig
	 * @param config
	 */
	export function setDefaultConfig(config: { name: string; value: any }[]) {
		config.forEach((pref) => {
			defaultConfig[pref.name] = pref.value;
		});
	}

	// eslint-disable-next-line no-inner-declarations
	function setConfig() {
		// Some skin dependent config.
		switch (mw.config.get('skin')) {
			case 'vector':
				defaultConfig.portletArea = 'right-navigation';
				defaultConfig.portletId = 'p-twinkle';
				defaultConfig.portletName = 'TW';
				defaultConfig.portletType = 'menu';
				defaultConfig.portletNext = 'p-search';
				break;
			case 'timeless':
				defaultConfig.portletArea = '#page-tools .sidebar-inner';
				defaultConfig.portletId = 'p-twinkle';
				defaultConfig.portletName = 'Twinkle';
				defaultConfig.portletType = null;
				defaultConfig.portletNext = 'p-userpagetools';
				break;
			default:
				defaultConfig.portletArea = null;
				defaultConfig.portletId = 'p-cactions';
				defaultConfig.portletName = null;
				defaultConfig.portletType = null;
				defaultConfig.portletNext = null;
		}
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
	export function addPortlet(
		navigation: string,
		id: string,
		text: string,
		type: string,
		nextnodeid: string
	): HTMLElement {
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

	/**
	 * Builds a portlet menu if it doesn't exist yet, and add the portlet link.
	 * @param task: Either a URL for the portlet link or a function to execute.
	 * @param text
	 * @param id
	 * @param tooltip
	 */
	export function addPortletLink(
		task: string | (() => void),
		text: string,
		id: string,
		tooltip: string
	): HTMLLIElement {
		if (Twinkle.getPref('portletArea') !== null) {
			Twinkle.addPortlet(
				Twinkle.getPref('portletArea'),
				Twinkle.getPref('portletId'),
				Twinkle.getPref('portletName'),
				Twinkle.getPref('portletType'),
				Twinkle.getPref('portletNext')
			);
		}
		let link = mw.util.addPortletLink(
			Twinkle.getPref('portletId'),
			typeof task === 'string' ? task : '#',
			text,
			id,
			tooltip
		);
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

	const userPrefsLoaded = $.Deferred();

	/**
	 * Adds a callback to execute when Twinkle has loaded.
	 * @param func
	 * @param [name] - name of module used to check if is disabled.
	 * If name is not given, module is loaded unconditionally.
	 */
	export function addInitCallback(func: () => void, name: string) {
		// initCallbacks.push({ func: func, name: name });
		userPrefsLoaded.then(() => {
			if (!name || disabledModules.indexOf(name) === -1) {
				func();
			}
		});
	}

	// List of modules that the *user* has disabled
	let disabledModules: string[] = [];

	/**
	 * List of registered modules
	 */
	export let registeredModules: typeof TwinkleModule[] = [];

	/**
	 * Load user preferences from the user's /twinkleoptions.js subpage,
	 * then initialises Twinkle
	 */
	export function init() {
		getUserPrefs().always(function () {
			if (
				mw.config.get('wgNamespaceNumber') === -1 &&
				!arr_includes(activeSpecialPages, mw.config.get('wgCanonicalSpecialPageName'))
			) {
				return;
			}

			// Prevent clickjacking
			if (window.top !== window.self) {
				return;
			}

			setConfig();

			disabledModules = Twinkle.getPref('disabledModules').concat(Twinkle.getPref('disabledSysopModules'));

			userPrefsLoaded.resolve(); // this triggers loading of modules via addInitCallback()

			// // Redefine addInitCallback so that any modules being loaded now on are directly
			// // initialised rather than added to initCallbacks array
			// Twinkle.addInitCallback = function(func, name) {
			// 	if (!name || disabledModules.indexOf(name) === -1) {
			// 		func();
			// 	}
			// };
			// // Initialise modules that were saved in initCallbacks array
			// initCallbacks.forEach(function(module) {
			// 	Twinkle.addInitCallback(module.func, module.name);
			// });

			// Populate messages
			loadMessages(messages);

			// Increases text size in Twinkle dialogs, if so configured
			if (Twinkle.getPref('dialogLargeFont')) {
				mw.util.addCSS(
					'.morebits-dialog-content, .morebits-dialog-footerlinks { font-size: 100% !important; } ' +
						'.morebits-dialog input, .morebits-dialog select, .morebits-dialog-content button { font-size: inherit !important; }'
				);
			}

			// Hide the lingering space if the TW menu is empty
			if (
				mw.config.get('skin') === 'vector' &&
				Twinkle.getPref('portletType') === 'menu' &&
				$('#p-twinkle').length === 0
			) {
				$('#p-cactions').css('margin-right', 'initial');
			}
		});
	}
}

function getUserPrefs(): JQuery.Promise<void> {
	let scriptpathbefore = mw.util.wikiScript('index') + '?title=',
		scriptpathafter = '&action=raw&ctype=text/javascript&happy=yes';

	return $.ajax({
		url:
			scriptpathbefore +
			'User:' +
			encodeURIComponent(mw.config.get('wgUserName')) +
			'/twinkleoptions.js' +
			scriptpathafter,
		dataType: 'text',
	})
		.then(function (optionsText) {
			// Quick pass if user has no options
			if (optionsText === '') {
				return;
			}

			// Twinkle options are basically a JSON object with some comments. Strip those:
			optionsText = optionsText.replace(/(?:^(?:\/\/[^\n]*\n)*\n*|(?:\/\/[^\n]*(?:\n|$))*$)/g, '');

			// First version of options had some boilerplate code to make it eval-able -- strip that too. This part may become obsolete down the line.
			if (optionsText.lastIndexOf('window.Twinkle.prefs = ', 0) === 0) {
				optionsText = optionsText.replace(/(?:^window.Twinkle.prefs = |;\n*$)/g, '');
			}

			try {
				let options = JSON.parse(optionsText);
				if (options) {
					if (options.twinkle || options.friendly) {
						// Old preferences format
						Twinkle.prefs = $.extend(options.twinkle, options.friendly);
					} else {
						Twinkle.prefs = options;
					}
					// v2 established after unification of Twinkle/Friendly objects
					Twinkle.prefs.optionsVersion = Twinkle.prefs.optionsVersion || 1;
				}
			} catch (e) {
				mw.notify('Could not parse your Twinkle preferences', { type: 'error' });
			}
		})
		.catch(function () {
			mw.notify('Could not load your Twinkle preferences', { type: 'error' });
			// not rejected
		});
}

/**
 * Base class for all Twinkle modules
 */
export class TwinkleModule {
	/**
	 * The name of the module, used to check if the user
	 * has the module disabled
	 */
	static moduleName: string;
	moduleName: string;

	portletName: string;
	portletId: string;
	portletTooltip: string;

	constructor() {
		let prefs = this.userPreferences();
		if (prefs) {
			Config.addSection(this.moduleName, { ...prefs, module: this.moduleName });
			Twinkle.setDefaultConfig(
				prefs.preferences.map((pref) => {
					return {
						name: pref.name,
						value: pref.default,
					};
				})
			);
		}
	}

	userPreferences(): { title: string; preferences: configPreference[] } | void {}

	addPreference(pref) {
		Config.addPreference(this.moduleName, pref);
	}

	addMenu() {
		Twinkle.addPortletLink(() => this.makeWindow(), this.portletName, this.portletId, this.portletTooltip);
	}

	/**
	 * Set of links shown in the bottom right of the module dialog.
	 * Object keys are labels and values are the wiki page names
	 */
	footerlinks: { [label: string]: string };

	makeWindow() {}
}

// Declare pre-existing globals. `Window` is the type of `window`.
declare global {
	interface Window {
		TwinkleConfig?: Record<string, any>;
		FriendlyConfig?: Record<string, any>;
	}
}
