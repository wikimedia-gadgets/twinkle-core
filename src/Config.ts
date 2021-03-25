import { Twinkle } from './twinkle';
import { obj_values } from './utils';

let prefs: Record<string, any>;

/**
 * This holds the default set of preferences used by Twinkle.
 * It is important that all new preferences added here, especially admin-only ones, are also added to
 * |Twinkle.config.sections| in twinkleconfig.js, so they are configurable via the Twinkle preferences panel.
 * For help on the actual preferences, see the comments in twinkleconfig.js.
 */
const defaultConfig = {
	optionsVersion: 2,

	// TODO: Use the defaults in Config.sections
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

	// Hidden preferences
	autolevelStaleDays: 3, // Huggle is 3, CBNG is 2
	revertMaxRevisions: 50, // intentionally limited
	batchMax: 5000,
	batchChunks: 50,

	// Deprecated options, as a fallback for add-on scripts/modules
	summaryAd: ' ([[WP:TW|TW]])',
	deletionSummaryAd: ' ([[WP:TW|TW]])',
	protectionSummaryAd: ' ([[WP:TW|TW]])',

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
	openTalkPage: ['agf', 'norm', 'vand'],
	openTalkPageOnAutoRevert: false,
	rollbackInPlace: false,
	markRevertedPagesAsMinor: ['vand'],
	watchRevertedPages: ['agf', 'norm', 'vand', 'torev'],
	watchRevertedExpiry: '1 month',
	offerReasonOnNormalRevert: true,
	confirmOnFluff: false,
	confirmOnMobileFluff: true,
	showRollbackLinks: ['diff', 'others'],

	// CSD
	speedySelectionStyle: 'buttonClick',
	watchSpeedyPages: ['g3', 'g5', 'g10', 'g11', 'g12'],
	watchSpeedyExpiry: '1 month',
	markSpeedyPagesAsPatrolled: false,

	// Warn
	defaultWarningGroup: '1',
	combinedSingletMenus: false,
	showSharedIPNotice: true,
	watchWarnings: '1 month',
	oldSelect: false,
	customWarningList: [],

	// ARV
	spiWatchReport: 'yes',

	// Welcome
	topWelcomes: false,
	watchWelcomes: '3 months',
	insertUsername: true,
	quickWelcomeMode: 'norm',
	quickWelcomeTemplate: 'welcome',
	customWelcomeList: [],
	customWelcomeSignature: true,

	// Shared
	markSharedIPAsMinor: true,

	// Talkback
	markTalkbackAsMinor: true,
	insertTalkbackSignature: true, // always sign talkback templates
	talkbackHeading: 'New message from ' + mw.config.get('wgUserName'),
	mailHeading: "You've got mail!",
};

/**
 * Extends the defaultConfig
 * @param config
 */
export function setDefaultConfig(config: { name: string; value: any }[]) {
	config.forEach((pref) => {
		defaultConfig[pref.name] = pref.value;
	});
}

export function getPref(name: string): any {
	if (typeof prefs === 'object' && prefs[name] !== undefined) {
		return prefs[name];
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
// Declare pre-existing globals. `Window` is the type of `window`.
declare global {
	interface Window {
		TwinkleConfig?: Record<string, any>;
		FriendlyConfig?: Record<string, any>;
	}
}

export function loadUserConfig(): JQuery.Promise<void> {
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
						prefs = $.extend(options.twinkle, options.friendly);
					} else {
						prefs = options;
					}
					// v2 established after unification of Twinkle/Friendly objects
					prefs.optionsVersion = prefs.optionsVersion || 1;
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

// TODO: Type this more tightly if possible
export type Preference = {
	name: string;
	type: 'boolean' | 'string' | 'enum' | 'integer' | 'set' | 'customList';
	label?: string;
	helptip?: string;
	enumValues?: Record<string, string>;
	setValues?: Record<string, string>;
	adminOnly?: boolean;
	default: boolean | string | number | { value: string; label: string }[];
};

export type PreferenceGroup = {
	title: string;
	module?: string;
	preferences: Preference[];
	adminOnly?: boolean;
	hidden?: boolean;
};

export class Config {
	static sections: Record<string, PreferenceGroup> = {
		general: {
			title: 'General',
			module: 'general',
			preferences: [
				// TwinkleConfig.userTalkPageMode may take arguments:
				// 'window': open a new window, remember the opened window
				// 'tab': opens in a new tab, if possible.
				// 'blank': force open in a new window, even if such a window exists
				{
					name: 'userTalkPageMode',
					label: 'When opening a user talk page, open it',
					type: 'enum',
					enumValues: {
						window: 'In a window, replacing other user talks',
						tab: 'In a new tab',
						blank: 'In a totally new window',
					},
					default: 'tab',
				},

				// TwinkleConfig.dialogLargeFont (boolean)
				{
					name: 'dialogLargeFont',
					label: 'Use larger text in Twinkle dialogs',
					type: 'boolean',
					default: false,
				},

				// Config.disabledModules (array)
				{
					name: 'disabledModules',
					label: 'Turn off the selected Twinkle modules',
					helptip: 'Anything you select here will NOT be available for use, so act with care. Uncheck to reactivate.',
					type: 'set',
					setValues: {
						arv: 'ARV',
						warn: 'Warn',
						welcome: 'Welcome',
						shared: 'Shared IP',
						talkback: 'Talkback',
						speedy: 'CSD',
						prod: 'PROD',
						xfd: 'XfD',
						image: 'Image (DI)',
						protect: 'Protect (RPP)',
						tag: 'Tag',
						diff: 'Diff',
						unlink: 'Unlink',
						fluff: 'Revert and rollback',
					},
					default: [],
				},

				// Config.disabledSysopModules (array)
				{
					name: 'disabledSysopModules',
					label: 'Turn off the selected admin-only modules',
					helptip: 'Anything you select here will NOT be available for use, so act with care. Uncheck to reactivate.',
					adminOnly: true,
					type: 'set',
					setValues: {
						block: 'Block',
						deprod: 'DePROD',
						batchdelete: 'D-batch',
						batchprotect: 'P-batch',
						batchundelete: 'Und-batch',
					},
					default: [],
				},
			],
		},

		hidden: {
			title: 'Hidden',
			hidden: true,
			preferences: [
				// twinkle.js: portlet setup
				{
					name: 'portletArea',
					type: 'string',
				},
				{
					name: 'portletId',
					type: 'string',
				},
				{
					name: 'portletName',
					type: 'string',
				},
				{
					name: 'portletType',
					type: 'string',
				},
				{
					name: 'portletNext',
					type: 'string',
				},
				// twinklefluff.js: defines how many revision to query maximum, maximum possible is 50, default is 50
				{
					name: 'revertMaxRevisions',
					type: 'integer',
					default: 50,
				},
				// twinklewarn.js: When using the autolevel select option, how many days makes a prior warning stale
				// Huggle is three days ([[Special:Diff/918980316]] and [[Special:Diff/919417999]]) while ClueBotNG is two:
				// https://github.com/DamianZaremba/cluebotng/blob/4958e25d6874cba01c75f11debd2e511fd5a2ce5/bot/action_functions.php#L62
				{
					name: 'autolevelStaleDays',
					type: 'integer',
					default: 3,
				},
				// How many pages should be queried by deprod and batchdelete/protect/undelete
				{
					name: 'batchMax',
					type: 'integer',
					adminOnly: true,
					default: 5000,
				},
				// How many pages should be processed at a time by deprod and batchdelete/protect/undelete
				{
					name: 'batchChunks',
					type: 'integer',
					adminOnly: true,
					default: 50,
				},
			],
		},
	};

	static addGroup(module: string, section: PreferenceGroup) {
		Config.sections[module] = section;
	}

	static addPreference(module: string, pref: Preference) {
		Config.sections[module].preferences.push(pref);
	}

	static init() {
		// create the config page at Wikipedia:Twinkle/Preferences
		if (
			mw.config.get('wgNamespaceNumber') === mw.config.get('wgNamespaceIds').project &&
			mw.config.get('wgTitle') === 'Twinkle/Preferences' &&
			mw.config.get('wgAction') === 'view'
		) {
			if (!document.getElementById('twinkle-config')) {
				return; // maybe the page is misconfigured, or something - but any attempt to modify it will be pointless
			}

			// set style (the url() CSS function doesn't seem to work from wikicode - ?!)
			document.getElementById('twinkle-config-titlebar').style.backgroundImage =
				'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAkCAMAAAB%2FqqA%2BAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAEhQTFRFr73ZobTPusjdsMHZp7nVwtDhzNbnwM3fu8jdq7vUt8nbxtDkw9DhpbfSvMrfssPZqLvVztbno7bRrr7W1d%2Fs1N7qydXk0NjpkW7Q%2BgAAADVJREFUeNoMwgESQCAAAMGLkEIi%2FP%2BnbnbpdB59app5Vdg0sXAoMZCpGoFbK6ciuy6FX4ABAEyoAef0BXOXAAAAAElFTkSuQmCC)';

			var contentdiv = document.getElementById('twinkle-config-content');
			contentdiv.textContent = ''; // clear children

			// let user know about possible conflict with skin js/common.js file
			// (settings in that file will still work, but they will be overwritten by twinkleoptions.js settings)
			if (window.TwinkleConfig || window.FriendlyConfig) {
				var contentnotice = document.createElement('p');
				contentnotice.innerHTML =
					'<table class="plainlinks ombox ombox-content"><tr><td class="mbox-image">' +
					'<img alt="" src="https://upload.wikimedia.org/wikipedia/commons/3/38/Imbox_content.png" /></td>' +
					'<td class="mbox-text"><p><big><b>Before modifying your settings here,</b> you must remove your old Twinkle and Friendly settings from your personal skin JavaScript.</big></p>' +
					'<p>To do this, you can <a href="' +
					mw.util.getUrl('User:' + mw.config.get('wgUserName') + '/' + mw.config.get('skin') + '.js', {
						action: 'edit',
					}) +
					'" target="_blank"><b>edit your personal skin javascript file</b></a> or <a href="' +
					mw.util.getUrl('User:' + mw.config.get('wgUserName') + '/common.js', { action: 'edit' }) +
					'" target="_blank"><b>your common.js file</b></a>, removing all lines of code that refer to <code>TwinkleConfig</code> and <code>FriendlyConfig</code>.</p>' +
					'</td></tr></table>';
				contentdiv.appendChild(contentnotice);
			}

			// start a table of contents
			var toctable = document.createElement('div');
			toctable.className = 'toc';
			toctable.style.marginLeft = '0.4em';
			// create TOC title
			var toctitle = document.createElement('div');
			toctitle.id = 'toctitle';
			var toch2 = document.createElement('h2');
			toch2.textContent = 'Contents ';
			toctitle.appendChild(toch2);
			// add TOC show/hide link
			var toctoggle = document.createElement('span');
			toctoggle.className = 'toctoggle';
			toctoggle.appendChild(document.createTextNode('['));
			var toctogglelink = document.createElement('a');
			toctogglelink.className = 'internal';
			toctogglelink.setAttribute('href', '#tw-tocshowhide');
			toctogglelink.textContent = 'hide';
			toctoggle.appendChild(toctogglelink);
			toctoggle.appendChild(document.createTextNode(']'));
			toctitle.appendChild(toctoggle);
			toctable.appendChild(toctitle);
			// create item container: this is what we add stuff to
			var tocul = document.createElement('ul');
			toctogglelink.addEventListener(
				'click',
				function twinkleconfigTocToggle() {
					var $tocul = $(tocul);
					$tocul.toggle();
					if ($tocul.find(':visible').length) {
						toctogglelink.textContent = 'hide';
					} else {
						toctogglelink.textContent = 'show';
					}
				},
				false
			);
			toctable.appendChild(tocul);
			contentdiv.appendChild(toctable);

			var contentform = document.createElement('form');
			contentform.setAttribute('action', 'javascript:void(0)'); // was #tw-save - changed to void(0) to work around Chrome issue
			contentform.addEventListener('submit', Config.save, true);
			contentdiv.appendChild(contentform);

			var container = document.createElement('table');
			container.style.width = '100%';
			contentform.appendChild(container);

			obj_values(Config.sections).forEach((section) => {
				if (section.hidden || (section.adminOnly && !Morebits.userIsSysop)) {
					return true; // i.e. "continue" in this context
				}

				// add to TOC
				var tocli = document.createElement('li');
				tocli.className = 'toclevel-1';
				var toca = document.createElement('a');
				toca.setAttribute('href', '#' + section.module);
				toca.appendChild(document.createTextNode(section.title));
				tocli.appendChild(toca);
				tocul.appendChild(tocli);

				var row = document.createElement('tr');
				var cell = document.createElement('td');
				cell.setAttribute('colspan', '3');
				var heading = document.createElement('h4');
				heading.style.borderBottom = '1px solid gray';
				heading.style.marginTop = '0.2em';
				heading.id = section.module;
				heading.appendChild(document.createTextNode(section.title));
				cell.appendChild(heading);
				row.appendChild(cell);
				container.appendChild(row);

				var rowcount = 1; // for row banding

				// add each of the preferences to the form
				section.preferences.forEach((pref) => {
					if (pref.adminOnly && !Morebits.userIsSysop) {
						return true; // i.e. "continue" in this context
					}

					row = document.createElement('tr');
					row.style.marginBottom = '0.2em';
					// create odd row banding
					if (rowcount++ % 2 === 0) {
						row.style.backgroundColor = 'rgba(128, 128, 128, 0.1)';
					}
					cell = document.createElement('td');

					var label,
						input,
						gotPref = getPref(pref.name);
					switch (pref.type) {
						case 'boolean': // create a checkbox
							cell.setAttribute('colspan', '2');

							label = document.createElement('label');
							input = document.createElement('input');
							input.setAttribute('type', 'checkbox');
							input.setAttribute('id', pref.name);
							input.setAttribute('name', pref.name);
							if (gotPref === true) {
								input.setAttribute('checked', 'checked');
							}
							label.appendChild(input);
							label.appendChild(document.createTextNode(' ' + pref.label));
							cell.appendChild(label);
							break;

						case 'string': // create an input box
						case 'integer':
							// add label to first column
							cell.style.textAlign = 'right';
							cell.style.paddingRight = '0.5em';
							label = document.createElement('label');
							label.setAttribute('for', pref.name);
							label.appendChild(document.createTextNode(pref.label + ':'));
							cell.appendChild(label);
							row.appendChild(cell);

							// add input box to second column
							cell = document.createElement('td');
							cell.style.paddingRight = '1em';
							input = document.createElement('input');
							input.setAttribute('type', 'text');
							input.setAttribute('id', pref.name);
							input.setAttribute('name', pref.name);
							if (pref.type === 'integer') {
								input.setAttribute('size', 6);
								input.setAttribute('type', 'number');
								input.setAttribute('step', '1'); // integers only
							}
							if (gotPref) {
								input.setAttribute('value', gotPref);
							}
							cell.appendChild(input);
							break;

						case 'enum': // create a combo box
							// add label to first column
							// note: duplicates the code above, under string/integer
							cell.style.textAlign = 'right';
							cell.style.paddingRight = '0.5em';
							label = document.createElement('label');
							label.setAttribute('for', pref.name);
							label.appendChild(document.createTextNode(pref.label + ':'));
							cell.appendChild(label);
							row.appendChild(cell);

							// add input box to second column
							cell = document.createElement('td');
							cell.style.paddingRight = '1em';
							input = document.createElement('select');
							input.setAttribute('id', pref.name);
							input.setAttribute('name', pref.name);
							$.each(pref.enumValues, function (enumvalue, enumdisplay) {
								var option = document.createElement('option');
								option.setAttribute('value', enumvalue);
								if (
									gotPref === enumvalue ||
									// Hack to convert old boolean watchlist prefs
									// to corresponding enums (added in v2.1)
									(typeof gotPref === 'boolean' &&
										((gotPref && enumvalue === 'yes') || (!gotPref && enumvalue === 'no')))
								) {
									option.setAttribute('selected', 'selected');
								}
								option.appendChild(document.createTextNode(enumdisplay));
								input.appendChild(option);
							});
							cell.appendChild(input);
							break;

						case 'set': // create a set of check boxes
							// add label first of all
							cell.setAttribute('colspan', '2');
							label = document.createElement('label'); // not really necessary to use a label element here, but we do it for consistency of styling
							label.appendChild(document.createTextNode(pref.label + ':'));
							cell.appendChild(label);

							var checkdiv = document.createElement('div');
							checkdiv.style.paddingLeft = '1em';
							var worker = function (itemkey, itemvalue) {
								var checklabel = document.createElement('label');
								checklabel.style.marginRight = '0.7em';
								checklabel.style.display = 'inline-block';
								var check = document.createElement('input');
								check.setAttribute('type', 'checkbox');
								check.setAttribute('id', pref.name + '_' + itemkey);
								check.setAttribute('name', pref.name + '_' + itemkey);
								if (gotPref && gotPref.indexOf(itemkey) !== -1) {
									check.setAttribute('checked', 'checked');
								}
								// cater for legacy integer array values for unlinkNamespaces (this can be removed a few years down the track...)
								if (pref.name === 'unlinkNamespaces') {
									if (gotPref && gotPref.indexOf(parseInt(itemkey, 10)) !== -1) {
										check.setAttribute('checked', 'checked');
									}
								}
								checklabel.appendChild(check);
								checklabel.appendChild(document.createTextNode(itemvalue));
								checkdiv.appendChild(checklabel);
							};
							if (pref.setDisplayOrder) {
								// add check boxes according to the given display order
								$.each(pref.setDisplayOrder, function (itemkey, item) {
									worker(item, pref.setValues[item]);
								});
							} else {
								// add check boxes according to the order it gets fed to us (probably strict alphabetical)
								$.each(pref.setValues, worker);
							}
							cell.appendChild(checkdiv);
							break;

						case 'customList':
							// add label to first column
							cell.style.textAlign = 'right';
							cell.style.paddingRight = '0.5em';
							label = document.createElement('label');
							label.setAttribute('for', pref.name);
							label.appendChild(document.createTextNode(pref.label + ':'));
							cell.appendChild(label);
							row.appendChild(cell);

							// add button to second column
							cell = document.createElement('td');
							cell.style.paddingRight = '1em';
							var button = document.createElement('button');
							button.setAttribute('id', pref.name);
							button.setAttribute('name', pref.name);
							button.setAttribute('type', 'button');
							button.addEventListener('click', ListDialog.display, false);
							// use jQuery data on the button to store the current config value
							$(button).data({
								value: gotPref,
								pref: pref,
							});
							button.appendChild(document.createTextNode('Edit items'));
							cell.appendChild(button);
							break;

						default:
							alert('twinkleconfig: unknown data type for preference ' + pref.name);
							break;
					}
					row.appendChild(cell);

					// add help tip
					cell = document.createElement('td');
					cell.style.fontSize = '90%';

					cell.style.color = 'gray';
					if (pref.helptip) {
						// convert mentions of templates in the helptip to clickable links
						cell.innerHTML = pref.helptip.replace(
							/{{(.+?)}}/g,
							'{{<a href="' + mw.util.getUrl('Template:') + '$1" target="_blank">$1</a>}}'
						);
					}
					// add reset link (custom lists don't need this, as their config value isn't displayed on the form)
					if (pref.type !== 'customList') {
						var resetlink = document.createElement('a');
						resetlink.setAttribute('href', '#tw-reset');
						resetlink.setAttribute('id', 'twinkle-config-reset-' + pref.name);
						resetlink.addEventListener('click', Config.resetPrefLink, false);
						resetlink.style.cssFloat = 'right';
						resetlink.style.margin = '0 0.6em';
						resetlink.appendChild(document.createTextNode('Reset'));
						cell.appendChild(resetlink);
					}
					row.appendChild(cell);

					container.appendChild(row);
					return true;
				});
				return true;
			});

			var footerbox = document.createElement('div');
			footerbox.setAttribute('id', 'twinkle-config-buttonpane');
			footerbox.style.backgroundColor = '#BCCADF';
			footerbox.style.padding = '0.5em';
			var button = document.createElement('button');
			button.setAttribute('id', 'twinkle-config-submit');
			button.setAttribute('type', 'submit');
			button.appendChild(document.createTextNode('Save changes'));
			footerbox.appendChild(button);
			var footerspan = document.createElement('span');
			footerspan.className = 'plainlinks';
			footerspan.style.marginLeft = '2.4em';
			footerspan.style.fontSize = '90%';
			var footera = document.createElement('a');
			footera.setAttribute('href', '#tw-reset-all');
			footera.setAttribute('id', 'twinkle-config-resetall');
			footera.addEventListener('click', Config.resetAllPrefs, false);
			footera.appendChild(document.createTextNode('Restore defaults'));
			footerspan.appendChild(footera);
			footerbox.appendChild(footerspan);
			contentform.appendChild(footerbox);

			// since all the section headers exist now, we can try going to the requested anchor
			if (window.location.hash) {
				var loc = window.location.hash;
				window.location.hash = '';
				window.location.hash = loc;
			}
		} else if (
			mw.config.get('wgNamespaceNumber') === mw.config.get('wgNamespaceIds').user &&
			mw.config.get('wgTitle').indexOf(mw.config.get('wgUserName')) === 0 &&
			mw.config.get('wgPageName').slice(-3) === '.js'
		) {
			var box = document.createElement('div');
			// Styled in twinkle.css
			box.setAttribute('id', 'twinkle-config-headerbox');

			var link,
				scriptPageName = mw.config
					.get('wgPageName')
					.slice(mw.config.get('wgPageName').lastIndexOf('/') + 1, mw.config.get('wgPageName').lastIndexOf('.js'));

			if (scriptPageName === 'twinkleoptions') {
				// place "why not try the preference panel" notice
				box.setAttribute('class', 'config-twopt-box');

				if (mw.config.get('wgArticleId') > 0) {
					// page exists
					box.appendChild(
						document.createTextNode('This page contains your Twinkle preferences. You can change them using the ')
					);
				} else {
					// page does not exist
					box.appendChild(document.createTextNode('You can customize Twinkle to suit your preferences by using the '));
				}
				link = document.createElement('a');
				link.setAttribute(
					'href',
					mw.util.getUrl(
						mw.config.get('wgFormattedNamespaces')[mw.config.get('wgNamespaceIds').project] + ':Twinkle/Preferences'
					)
				);
				link.appendChild(document.createTextNode('Twinkle preferences panel'));
				box.appendChild(link);
				box.appendChild(document.createTextNode(', or by editing this page.'));
				$(box).insertAfter($('#contentSub'));
			} else if (
				['monobook', 'vector', 'cologneblue', 'modern', 'timeless', 'minerva', 'common'].indexOf(scriptPageName) !== -1
			) {
				// place "Looking for Twinkle options?" notice
				box.setAttribute('class', 'config-userskin-box');

				box.appendChild(document.createTextNode('If you want to set Twinkle preferences, you can use the '));
				link = document.createElement('a');
				link.setAttribute(
					'href',
					mw.util.getUrl(
						mw.config.get('wgFormattedNamespaces')[mw.config.get('wgNamespaceIds').project] + ':Twinkle/Preferences'
					)
				);
				link.appendChild(document.createTextNode('Twinkle preferences panel'));
				box.appendChild(link);
				box.appendChild(document.createTextNode('.'));
				$(box).insertAfter($('#contentSub'));
			}
		}
	}

	static resetPrefLink(e) {
		var wantedpref = e.target.id.substring(21); // "twinkle-config-reset-" prefix is stripped

		// search tactics
		obj_values(Config.sections).forEach(function (section) {
			if (section.hidden || (section.adminOnly && !Morebits.userIsSysop)) {
				return true; // continuze: skip impossibilities
			}

			var foundit = false;

			section.preferences.forEach((pref) => {
				if (pref.name !== wantedpref) {
					return true; // continue
				}
				Config.resetPref(pref);
				foundit = true;
				return false; // break
			});

			if (foundit) {
				return false; // break
			}
		});
		return false; // stop link from scrolling page
	}

	static resetPref(pref: Omit<Preference, 'default'>) {
		switch (pref.type) {
			case 'boolean':
				(document.getElementById(pref.name) as HTMLInputElement).checked = defaultConfig[pref.name];
				break;

			case 'string':
			case 'integer':
			case 'enum':
				(document.getElementById(pref.name) as HTMLInputElement).value = defaultConfig[pref.name];
				break;

			case 'set':
				$.each(pref.setValues, function (itemkey) {
					let checkbox = document.getElementById(pref.name + '_' + itemkey) as HTMLInputElement;
					if (checkbox) {
						checkbox.checked = defaultConfig[pref.name].indexOf(itemkey) !== -1;
					}
				});
				break;

			case 'customList':
				$(document.getElementById(pref.name)).data('value', defaultConfig[pref.name]);
				break;

			default:
				alert('twinkleconfig: unknown data type for preference ' + pref.name);
				break;
		}
	}

	static resetAllPrefs() {
		// no confirmation message - the user can just refresh/close the page to abort
		obj_values(Config.sections).forEach(function (section: PreferenceGroup) {
			if (section.hidden || (section.adminOnly && !Morebits.userIsSysop)) {
				return true; // continue: skip impossibilities
			}
			section.preferences.forEach(function (pref: Preference) {
				if (!pref.adminOnly || Morebits.userIsSysop) {
					Config.resetPref(pref);
				}
			});
			return true;
		});
		return false; // stop link from scrolling page
	}

	static save(e) {
		Morebits.status.init(document.getElementById('twinkle-config-content'));

		var userjs =
			mw.config.get('wgFormattedNamespaces')[mw.config.get('wgNamespaceIds').user] +
			':' +
			mw.config.get('wgUserName') +
			'/twinkleoptions.js';
		var wikipedia_page = new Morebits.wiki.page(userjs, 'Saving preferences to ' + userjs);
		wikipedia_page.setCallbackParameters(e.target);
		wikipedia_page.load(Config.writePrefs);

		return false;
	}

	static writePrefs(pageobj) {
		var form = pageobj.getCallbackParameters();

		// this is the object which gets serialized into JSON; only
		// preferences that this script knows about are kept
		var newConfig = { optionsVersion: 2.1 };

		// a comparison function is needed later on
		// it is just enough for our purposes (i.e. comparing strings, numbers, booleans,
		// arrays of strings, and arrays of { value, label })
		// and it is not very robust: e.g. compare([2], ["2"]) === true, and
		// compare({}, {}) === false, but it's good enough for our purposes here
		var compare = function (a, b) {
			if (Array.isArray(a)) {
				if (a.length !== b.length) {
					return false;
				}
				var asort = a.sort(),
					bsort = b.sort();
				for (var i = 0; asort[i]; ++i) {
					// comparison of the two properties of custom lists
					if (
						typeof asort[i] === 'object' &&
						(asort[i].label !== bsort[i].label || asort[i].value !== bsort[i].value)
					) {
						return false;
					} else if (asort[i].toString() !== bsort[i].toString()) {
						return false;
					}
				}
				return true;
			}
			return a === b;
		};

		obj_values(Config.sections).forEach(function (section: PreferenceGroup) {
			if (section.adminOnly && !Morebits.userIsSysop) {
				return; // i.e. "continue" in this context
			}

			// reach each of the preferences from the form
			section.preferences.forEach(function (pref: Preference) {
				var userValue; // = undefined

				// only read form values for those prefs that have them
				if (!pref.adminOnly || Morebits.userIsSysop) {
					if (!section.hidden) {
						switch (pref.type) {
							case 'boolean': // read from the checkbox
								userValue = form[pref.name].checked;
								break;

							case 'string': // read from the input box or combo box
							case 'enum':
								userValue = form[pref.name].value;
								break;

							case 'integer': // read from the input box
								userValue = parseInt(form[pref.name].value, 10);
								if (isNaN(userValue)) {
									Morebits.status.warn(
										'Saving',
										'The value you specified for ' +
											pref.name +
											' (' +
											form[pref.name].value +
											') was invalid.  The save will continue, but the invalid data value will be skipped.'
									);
									userValue = null;
								}
								break;

							case 'set': // read from the set of check boxes
								userValue = [];
								if (pref.setDisplayOrder) {
									// read only those keys specified in the display order
									$.each(pref.setDisplayOrder, function (itemkey, item) {
										if (form[pref.name + '_' + item].checked) {
											userValue.push(item);
										}
									});
								} else {
									// read all the keys in the list of values
									$.each(pref.setValues, function (itemkey) {
										if (form[pref.name + '_' + itemkey].checked) {
											userValue.push(itemkey);
										}
									});
								}
								break;

							case 'customList': // read from the jQuery data stored on the button object
								userValue = $(form[pref.name]).data('value');
								break;

							default:
								alert('twinkleconfig: unknown data type for preference ' + pref.name);
								break;
						}
					} else if (prefs) {
						// Retain the hidden preferences that may have customised by the user from twinkleoptions.js
						// undefined if not set
						userValue = prefs[pref.name];
					}
				}

				// only save those preferences that are *different* from the default
				if (userValue !== undefined && !compare(userValue, defaultConfig[pref.name])) {
					newConfig[pref.name] = userValue;
				}
			});
		});

		var text =
			'// twinkleoptions.js: personal Twinkle preferences file\n' +
			'//\n' +
			'// NOTE: The easiest way to change your Twinkle preferences is by using the\n' +
			'// Twinkle preferences panel, at [[' +
			Morebits.pageNameNorm +
			']].\n' +
			'//\n' +
			'// This file is AUTOMATICALLY GENERATED.  Any changes you make (aside from\n' +
			'// changing the configuration parameters in a valid-JavaScript way) will be\n' +
			'// overwritten the next time you click "save" in the Twinkle preferences\n' +
			'// panel.  If modifying this file, make sure to use correct JavaScript.\n' +
			'// <no' +
			'wiki>\n' +
			'\n' +
			'window.Twinkle.prefs = ';
		text += JSON.stringify(newConfig, null, 2);
		text += ';\n' + '\n' + '// </no' + 'wiki>\n' + '// End of twinkleoptions.js\n';

		pageobj.setPageText(text);
		pageobj.setEditSummary('Saving Twinkle preferences: automatic edit from [[:' + Morebits.pageNameNorm + ']]');
		pageobj.setChangeTags(Twinkle.changeTags);
		pageobj.setCreateOption('recreate');
		pageobj.save(Config.saveSuccess);
	}

	static saveSuccess(pageobj) {
		pageobj.getStatusElement().info('successful');

		var noticebox = document.createElement('div');
		noticebox.className = 'successbox';
		noticebox.style.fontSize = '100%';
		noticebox.style.marginTop = '2em';
		noticebox.innerHTML =
			'<p><b>Your Twinkle preferences have been saved.</b></p><p>To see the changes, you will need to <b>clear your browser cache entirely</b> (see <a href="' +
			mw.util.getUrl('WP:BYPASS') +
			'" title="WP:BYPASS">WP:BYPASS</a> for instructions).</p>';
		Morebits.status.root.appendChild(noticebox);
		var noticeclear = document.createElement('br');
		noticeclear.style.clear = 'both';
		Morebits.status.root.appendChild(noticeclear);
	}

	static watchlistEnums = {
		'yes': 'Add to watchlist (indefinitely)',
		'no': "Don't add to watchlist",
		'default': 'Follow your site preferences',
		'1 week': 'Watch for 1 week',
		'1 month': 'Watch for 1 month',
		'3 months': 'Watch for 3 months',
		'6 months': 'Watch for 6 months',
	};

	static commonSets = {
		csdCriteria: {
			db: 'Custom rationale ({{db}})',
			g1: 'G1',
			g2: 'G2',
			g3: 'G3',
			g4: 'G4',
			g5: 'G5',
			g6: 'G6',
			g7: 'G7',
			g8: 'G8',
			g10: 'G10',
			g11: 'G11',
			g12: 'G12',
			g13: 'G13',
			g14: 'G14',
			a1: 'A1',
			a2: 'A2',
			a3: 'A3',
			a5: 'A5',
			a7: 'A7',
			a9: 'A9',
			a10: 'A10',
			a11: 'A11',
			u1: 'U1',
			u2: 'U2',
			u3: 'U3',
			u5: 'U5',
			f1: 'F1',
			f2: 'F2',
			f3: 'F3',
			f7: 'F7',
			f8: 'F8',
			f9: 'F9',
			f10: 'F10',
			c1: 'C1',
			r2: 'R2',
			r3: 'R3',
			r4: 'R4',
			p1: 'P1',
			p2: 'P2',
		},
		csdCriteriaDisplayOrder: [
			'db',
			'g1',
			'g2',
			'g3',
			'g4',
			'g5',
			'g6',
			'g7',
			'g8',
			'g10',
			'g11',
			'g12',
			'g13',
			'g14',
			'a1',
			'a2',
			'a3',
			'a5',
			'a7',
			'a9',
			'a10',
			'a11',
			'u1',
			'u2',
			'u3',
			'u5',
			'f1',
			'f2',
			'f3',
			'f7',
			'f8',
			'f9',
			'f10',
			'c1',
			'r2',
			'r3',
			'r4',
			'p1',
			'p2',
		],
		csdCriteriaNotification: {
			db: 'Custom rationale ({{db}})',
			g1: 'G1',
			g2: 'G2',
			g3: 'G3',
			g4: 'G4',
			g6: 'G6 ("copy-paste move" only)',
			g10: 'G10',
			g11: 'G11',
			g12: 'G12',
			g13: 'G13',
			g14: 'G14',
			a1: 'A1',
			a2: 'A2',
			a3: 'A3',
			a5: 'A5',
			a7: 'A7',
			a9: 'A9',
			a10: 'A10',
			a11: 'A11',
			u3: 'U3',
			u5: 'U5',
			f1: 'F1',
			f2: 'F2',
			f3: 'F3',
			f7: 'F7',
			f9: 'F9',
			f10: 'F10',
			c1: 'C1',
			r2: 'R2',
			r3: 'R3',
			r4: 'R4',
			p1: 'P1',
			p2: 'P2',
		},
		csdCriteriaNotificationDisplayOrder: [
			'db',
			'g1',
			'g2',
			'g3',
			'g4',
			'g6',
			'g10',
			'g11',
			'g12',
			'g13',
			'g14',
			'a1',
			'a2',
			'a3',
			'a5',
			'a7',
			'a9',
			'a10',
			'a11',
			'u3',
			'u5',
			'f1',
			'f2',
			'f3',
			'f7',
			'f9',
			'f10',
			'c1',
			'r2',
			'r3',
			'r4',
			'p1',
			'p2',
		],
		csdAndDICriteria: {
			db: 'Custom rationale ({{db}})',
			g1: 'G1',
			g2: 'G2',
			g3: 'G3',
			g4: 'G4',
			g5: 'G5',
			g6: 'G6',
			g7: 'G7',
			g8: 'G8',
			g10: 'G10',
			g11: 'G11',
			g12: 'G12',
			g13: 'G13',
			g14: 'G14',
			a1: 'A1',
			a2: 'A2',
			a3: 'A3',
			a5: 'A5',
			a7: 'A7',
			a9: 'A9',
			a10: 'A10',
			a11: 'A11',
			u1: 'U1',
			u2: 'U2',
			u3: 'U3',
			u5: 'U5',
			f1: 'F1',
			f2: 'F2',
			f3: 'F3',
			f4: 'F4',
			f5: 'F5',
			f6: 'F6',
			f7: 'F7',
			f8: 'F8',
			f9: 'F9',
			f10: 'F10',
			f11: 'F11',
			c1: 'C1',
			r2: 'R2',
			r3: 'R3',
			r4: 'R4',
			p1: 'P1',
			p2: 'P2',
		},
		csdAndDICriteriaDisplayOrder: [
			'db',
			'g1',
			'g2',
			'g3',
			'g4',
			'g5',
			'g6',
			'g7',
			'g8',
			'g10',
			'g11',
			'g12',
			'g13',
			'g14',
			'a1',
			'a2',
			'a3',
			'a5',
			'a7',
			'a9',
			'a10',
			'a11',
			'u1',
			'u2',
			'u3',
			'u5',
			'f1',
			'f2',
			'f3',
			'f4',
			'f5',
			'f6',
			'f7',
			'f8',
			'f9',
			'f10',
			'f11',
			'c1',
			'r2',
			'r3',
			'r4',
			'p1',
			'p2',
		],
		namespacesNoSpecial: {
			0: 'Article',
			1: 'Talk (article)',
			2: 'User',
			3: 'User talk',
			4: 'Wikipedia',
			5: 'Wikipedia talk',
			6: 'File',
			7: 'File talk',
			8: 'MediaWiki',
			9: 'MediaWiki talk',
			10: 'Template',
			11: 'Template talk',
			12: 'Help',
			13: 'Help talk',
			14: 'Category',
			15: 'Category talk',
			100: 'Portal',
			101: 'Portal talk',
			108: 'Book',
			109: 'Book talk',
			118: 'Draft',
			119: 'Draft talk',
			710: 'TimedText',
			711: 'TimedText talk',
			828: 'Module',
			829: 'Module talk',
		},
	};
}

class ListDialog {
	static addRow(dlgtable, value?, label?) {
		var contenttr = document.createElement('tr');
		// "remove" button
		var contenttd = document.createElement('td');
		var removeButton = document.createElement('button');
		removeButton.setAttribute('type', 'button');
		removeButton.addEventListener(
			'click',
			function () {
				$(contenttr).remove();
			},
			false
		);
		removeButton.textContent = 'Remove';
		contenttd.appendChild(removeButton);
		contenttr.appendChild(contenttd);

		// value input box
		contenttd = document.createElement('td');
		var input = document.createElement('input');
		input.setAttribute('type', 'text');
		input.className = 'twinkle-config-customlist-value';
		input.style.width = '97%';
		if (value) {
			input.setAttribute('value', value);
		}
		contenttd.appendChild(input);
		contenttr.appendChild(contenttd);

		// label input box
		contenttd = document.createElement('td');
		input = document.createElement('input');
		input.setAttribute('type', 'text');
		input.className = 'twinkle-config-customlist-label';
		input.style.width = '98%';
		if (label) {
			input.setAttribute('value', label);
		}
		contenttd.appendChild(input);
		contenttr.appendChild(contenttd);

		dlgtable.appendChild(contenttr);
	}

	static display(e) {
		var $prefbutton = $(e.target);
		var curvalue = $prefbutton.data('value');
		var curpref = $prefbutton.data('pref');

		var dialog = new Morebits.simpleWindow(720, 400);
		dialog.setTitle(curpref.label);
		dialog.setScriptName('Twinkle preferences');

		var dialogcontent = document.createElement('div');
		var dlgtable = document.createElement('table');
		dlgtable.className = 'wikitable';
		dlgtable.style.margin = '1.4em 1em';
		dlgtable.style.width = 'auto';

		var dlgtbody = document.createElement('tbody');

		// header row
		var dlgtr = document.createElement('tr');
		// top-left cell
		var dlgth = document.createElement('th');
		dlgth.style.width = '5%';
		dlgtr.appendChild(dlgth);
		// value column header
		dlgth = document.createElement('th');
		dlgth.style.width = '35%';
		dlgth.textContent = curpref.customListValueTitle ? curpref.customListValueTitle : 'Value';
		dlgtr.appendChild(dlgth);
		// label column header
		dlgth = document.createElement('th');
		dlgth.style.width = '60%';
		dlgth.textContent = curpref.customListLabelTitle ? curpref.customListLabelTitle : 'Label';
		dlgtr.appendChild(dlgth);
		dlgtbody.appendChild(dlgtr);

		// content rows
		var gotRow = false;
		$.each(curvalue, function (k, v) {
			gotRow = true;
			ListDialog.addRow(dlgtbody, v.value, v.label);
		});
		// if there are no values present, add a blank row to start the user off
		if (!gotRow) {
			ListDialog.addRow(dlgtbody);
		}

		// final "add" button
		var dlgtfoot = document.createElement('tfoot');
		dlgtr = document.createElement('tr');
		var dlgtd = document.createElement('td');
		dlgtd.setAttribute('colspan', '3');
		var addButton = document.createElement('button');
		addButton.style.minWidth = '8em';
		addButton.setAttribute('type', 'button');
		addButton.addEventListener(
			'click',
			function () {
				ListDialog.addRow(dlgtbody);
			},
			false
		);
		addButton.textContent = 'Add';
		dlgtd.appendChild(addButton);
		dlgtr.appendChild(dlgtd);
		dlgtfoot.appendChild(dlgtr);

		dlgtable.appendChild(dlgtbody);
		dlgtable.appendChild(dlgtfoot);
		dialogcontent.appendChild(dlgtable);

		// buttonpane buttons: [Save changes] [Reset] [Cancel]
		var button = document.createElement('button');
		button.setAttribute('type', 'submit'); // so Morebits.simpleWindow puts the button in the button pane
		button.addEventListener(
			'click',
			function () {
				ListDialog.save($prefbutton, dlgtbody);
				dialog.close();
			},
			false
		);
		button.textContent = 'Save changes';
		dialogcontent.appendChild(button);
		button = document.createElement('button');
		button.setAttribute('type', 'submit'); // so Morebits.simpleWindow puts the button in the button pane
		button.addEventListener(
			'click',
			function () {
				ListDialog.reset($prefbutton, dlgtbody);
			},
			false
		);
		button.textContent = 'Reset';
		dialogcontent.appendChild(button);
		button = document.createElement('button');
		button.setAttribute('type', 'submit'); // so Morebits.simpleWindow puts the button in the button pane
		button.addEventListener(
			'click',
			function () {
				dialog.close(); // the event parameter on this function seems to be broken
			},
			false
		);
		button.textContent = 'Cancel';
		dialogcontent.appendChild(button);

		dialog.setContent(dialogcontent);
		dialog.display();
	}

	// Resets the data value, re-populates based on the new (default) value, then saves the
	// old data value again (less surprising behaviour)
	static reset(button, tbody) {
		// reset value on button
		var $button = $(button);
		var curpref = $button.data('pref');
		var oldvalue = $button.data('value');
		Config.resetPref(curpref);

		// reset form
		var $tbody = $(tbody);
		$tbody.find('tr').slice(1).remove(); // all rows except the first (header) row
		// add the new values
		var curvalue = $button.data('value');
		$.each(curvalue, function (k, v) {
			ListDialog.addRow(tbody, v.value, v.label);
		});

		// save the old value
		$button.data('value', oldvalue);
	}

	static save(button, tbody) {
		var result = [];
		var current = {};
		$(tbody)
			.find('input[type="text"]')
			.each(function (inputkey, input: HTMLInputElement) {
				if ($(input).hasClass('twinkle-config-customlist-value')) {
					current = { value: input.value };
				} else {
					current.label = input.value;
					// exclude totally empty rows
					if (current.value || current.label) {
						result.push(current);
					}
				}
			});
		$(button).data('value', result);
	}
}
