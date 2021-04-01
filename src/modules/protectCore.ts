import { Twinkle } from '../twinkle';
import { TwinkleModule } from '../twinkleModule';
import { Dialog } from '../Dialog';
import {
	arr_includes,
	isTextRedirect,
	LogEvent,
	makeTemplate,
	obj_entries,
	str_endsWith,
	str_startsWith,
} from '../utils';
import { getPref } from '../Config';
import { msg } from '../messenger';
import { NS_TEMPLATE } from '../namespaces';
import { Page } from '../Page';
import { Api } from '../Api';
import { SiteConfig } from '../siteConfig';

export abstract class ProtectCore extends TwinkleModule {
	moduleName = 'protect';
	static moduleName = 'protect';

	portletName = Morebits.userIsSysop ? 'PP' : 'RPP';
	portletId = 'twinkle-protect';
	portletTooltip = Morebits.userIsSysop ? 'Protect page' : 'Request page protection';
	windowTitle = Morebits.userIsSysop ? 'Apply, request or tag page protection' : 'Request or tag page protection';

	requestPageName = 'Wikipedia:Requests for page protection';
	requestPageAcronym = 'RfPP';

	constructor() {
		super();
		if (mw.config.get('wgNamespaceNumber') < 0 || mw.config.get('wgNamespaceNumber') === 8) {
			return;
		}
		this.addMenu();
	}

	makeWindow() {
		var Window = new Dialog(620, 530);
		Window.setTitle(this.windowTitle);
		Window.setFooterLinks(this.footerlinks);

		var form = new Morebits.quickForm(this.evaluate.bind(this));
		var actionfield = form.append({
			type: 'field',
			label: msg('protect-action-type'),
		});
		actionfield.append({
			type: 'radio',
			name: 'actiontype',
			event: this.changeAction.bind(this),
			list: [
				{
					label: msg('protect-protect-label'),
					value: 'protect',
					tooltip: msg('protect-protect-tooltip'),
					checked: true,
					adminonly: true,
				},
				{
					label: msg('protect-request-label'),
					value: 'request',
					tooltip: Morebits.userIsSysop ? msg('protect-request-sysop-tooltip') : msg('protect-request-tooltip'),
					checked: !Morebits.userIsSysop,
				},
				{
					label: msg('protect-tag-label'),
					value: 'tag',
					tooltip: msg('protect-tag-tooltip'),
					disabled: !this.canTag(),
				},
			],
		});

		form.append({ type: 'field', label: msg('preset'), name: 'field_preset' });
		form.append({ type: 'field', label: '1', name: 'field1' });
		form.append({ type: 'field', label: '2', name: 'field2' });

		form.append({ type: 'submit' });

		var result = form.render();
		Window.setContent(result);
		Window.display();

		// We must init the controls
		var evt = document.createEvent('Event');
		evt.initEvent('change', true, true);
		result.actiontype[0].dispatchEvent(evt);

		this.fetchProtectionLevel();
	}

	// Check if FlaggedRevs extension is enabled
	hasFlaggedRevs =
		mw.loader.getState('ext.flaggedRevs.review') &&
		arr_includes(SiteConfig.flaggedRevsNamespaces, mw.config.get('wgNamespaceNumber'));

	// Limit template editor; a Twinkle restriction, not a site setting
	isTemplate = mw.config.get('wgNamespaceNumber') === 10 || mw.config.get('wgNamespaceNumber') === 828;

	currentProtectionLevels: Record<
		string,
		{
			level: string;
			expiry: string;
			cascade?: boolean;
			admin?: string;
			source?: string;
		}
	> = {};

	//   this.fetchProtectingAdmin(apiObject, pageName, protect/stable).done((admin_username) => {
	// ...code... });
	fetchProtectingAdmin(api, pageName, protType, logIds?) {
		logIds = logIds || [];

		return api
			.get({
				format: 'json',
				action: 'query',
				list: 'logevents',
				letitle: pageName,
				letype: protType,
			})
			.then((data) => {
				// don't check log entries that have already been checked (e.g. don't go into an infinite loop!)
				var event = data.query
					? $.grep(data.query.logevents, (le: LogEvent) => {
							return $.inArray(le.logid, logIds);
					  })[0]
					: null;
				if (!event) {
					// fail gracefully
					return null;
				} else if (event.action === 'move_prot' || event.action === 'move_stable') {
					return this.fetchProtectingAdmin(
						api,
						protType === 'protect' ? event.params.oldtitle_title : event.params.oldtitle,
						protType,
						logIds.concat(event.logid)
					);
				}
				return event.user;
			});
	}

	watched: string | boolean;

	fetchProtectionLevel() {
		var api = new mw.Api();

		var earlyDecision = [
			api.get({
				format: 'json',
				indexpageids: true,
				action: 'query',
				list: 'logevents',
				letype: 'protect',
				letitle: mw.config.get('wgPageName'),
				prop: this.hasFlaggedRevs ? 'info|flagged' : 'info',
				inprop: 'protection|watched',
				titles: mw.config.get('wgPageName'),
			}),
		];
		if (this.hasFlaggedRevs) {
			earlyDecision.push(
				api.get({
					format: 'json',
					action: 'query',
					list: 'logevents',
					letype: 'stable',
					letitle: mw.config.get('wgPageName'),
				})
			);
		}

		$.when.apply($, earlyDecision).done((protectData, stableData) => {
			// $.when.apply is supposed to take an unknown number of promises
			// via an array, which it does, but the type of data returned varies.
			// If there are two or more deferreds, it returns an array (of objects),
			// but if there's just one deferred, it retuns a simple object.
			// This is annoying.
			protectData = $(protectData).toArray();

			var pageid = protectData[0].query.pageids[0];
			var page = protectData[0].query.pages[pageid];
			var current: typeof ProtectCore.prototype.currentProtectionLevels = {},
				adminEditDeferred;

			// Save requested page's watched status for later in case needed when filing request
			this.watched = page.watchlistexpiry || page.watched === '';

			$.each(page.protection, (index, protection) => {
				// Don't overwrite actual page protection with cascading protection
				if (!protection.source) {
					current[protection.type] = {
						level: protection.level,
						expiry: protection.expiry,
						cascade: protection.cascade === '',
					};
					// logs report last admin who made changes to either edit/move/create protection, regardless if
					// they only modified one of them
					if (!adminEditDeferred) {
						adminEditDeferred = this.fetchProtectingAdmin(api, mw.config.get('wgPageName'), 'protect');
					}
				} else {
					// Account for the page being covered by cascading protection
					current.cascading = {
						expiry: protection.expiry,
						source: protection.source,
						level: protection.level, // should always be sysop, unused
					};
				}
			});

			if (page.flagged && page.flagged.protection_level) {
				current.stabilize = {
					level: page.flagged.protection_level,
					expiry: page.flagged.protection_expiry,
				};
				adminEditDeferred = this.fetchProtectingAdmin(api, mw.config.get('wgPageName'), 'stable');
			}

			// show the protection level and log info
			this.hasProtectLog = !!protectData[0].query.logevents.length;
			this.protectLog = this.hasProtectLog && protectData[0].query.logevents;
			this.hasStableLog = this.hasFlaggedRevs ? !!stableData[0].query.logevents.length : false;
			this.stableLog = this.hasStableLog && stableData[0].query.logevents;
			this.currentProtectionLevels = current;

			if (adminEditDeferred) {
				adminEditDeferred.done((admin) => {
					if (admin) {
						$.each(['edit', 'move', 'create', 'stabilize', 'cascading'], (i, type) => {
							if (this.currentProtectionLevels[type]) {
								this.currentProtectionLevels[type].admin = admin;
							}
						});
					}
					this.showLogAndCurrentProtectInfo();
				});
			} else {
				this.showLogAndCurrentProtectInfo();
			}
		});
	}

	hasProtectLog: boolean;
	hasStableLog: boolean;
	protectLog: false | LogEvent[];
	stableLog: false | LogEvent[];

	showLogAndCurrentProtectInfo() {
		var currentlyProtected = !$.isEmptyObject(this.currentProtectionLevels);

		if (this.hasProtectLog || this.hasStableLog) {
			var $linkMarkup = $('<span>');

			if (this.hasProtectLog) {
				$linkMarkup.append(
					$(
						link(msg('protectlogpage'), 'Special:Log', {
							action: 'view',
							page: mw.config.get('wgPageName'),
							type: 'protect',
						})
					)
				);
				if (!currentlyProtected || (!this.currentProtectionLevels.edit && !this.currentProtectionLevels.move)) {
					var lastProtectAction = this.protectLog[0];
					if (lastProtectAction.action === 'unprotect') {
						$linkMarkup.append(
							msg('word-separator'),
							msg('parentheses', msg('unprotected-time', lastProtectAction.timestamp))
						);
					} else {
						// protect or modify
						$linkMarkup.append(
							msg('word-separator'),
							msg('parentheses', msg('expired-time', lastProtectAction.params.details[0].expiry))
						);
					}
				}
				$linkMarkup.append(this.hasStableLog ? msg('bullet-separator') : null);
			}

			if (this.hasStableLog) {
				$linkMarkup.append(
					$(
						link(msg('stable-logpage'), 'Special:Log', {
							action: 'view',
							page: mw.config.get('wgPageName'),
							type: 'stable',
						})
					)
				);
				if (!currentlyProtected || !this.currentProtectionLevels.stabilize) {
					var lastStabilizeAction = this.stableLog[0];
					if (lastStabilizeAction.action === 'reset') {
						$linkMarkup.append(
							msg('word-separator'),
							msg('parentheses', msg('reset-time', lastStabilizeAction.timestamp))
						);
					} else {
						// config or modify
						$linkMarkup.append(
							msg('word-separator'),
							msg('parentheses', msg('expired-time', lastStabilizeAction.params.expiry))
						);
					}
				}
			}

			Morebits.status.init($('div[name="hasprotectlog"] span')[0]);
			Morebits.status.warn(currentlyProtected ? msg('prev-protections') : msg('past-protected'), $linkMarkup[0]);
		}

		Morebits.status.init($('div[name="currentprot"] span')[0]);
		var protectionNode = [],
			statusLevel = 'info';

		if (currentlyProtected) {
			$.each(this.currentProtectionLevels, (type, settings) => {
				if (type === 'cascading') {
					protectionNode.push(msg('protect-cascade-from', settings.source));
				} else if (type === 'stabilize') {
					protectionNode.push(msg('protect-current-stable', msg('group-' + settings.level)));
				} else {
					// Make cascading protection more prominent
					if (settings.cascade) {
						protectionNode.push(
							msg('protect-current-cascading', msg('restriction-' + type), msg('restriction-level-' + settings.level))
						);
					}
					protectionNode.push(
						msg('protect-current', msg('restriction-' + type), msg('restriction-level-' + settings.level))
					);
				}

				if (settings.expiry === 'infinity') {
					protectionNode.push(msg('word-separator'), msg('protect-expiry-indefinite'), msg('word-separator'));
				} else {
					protectionNode.push(
						msg('word-separator'),
						msg('parentheses', msg('expires-time', settings.expiry)),
						msg('word-separator')
					);
				}
				if (settings.admin) {
					protectionNode.push(msg('by-sysop', settings.admin));
				}
				protectionNode.push(msg('bullet-separator'));
			});

			protectionNode = protectionNode.slice(0, -1); // remove the trailing bullet
			statusLevel = 'warn';
		} else {
			protectionNode.push(msg('protect-current-none'));
		}

		Morebits.status[statusLevel](msg('protect-current-label'), protectionNode);
	}

	changeAction(e) {
		let field_preset, field1, field2;
		let protectionLevels = this.getProtectionLevels();
		let protectionLengths = this.getProtectionLengths();
		let protectionTypes = this.getProtectionPresets();
		let protectionTypesCreate = this.getCreateProtectionPresets();

		const protLevelsToQuickformList = (levels: typeof protectionLevels, type: string) =>
			obj_entries(levels)
				.filter(([, data]) => {
					return (
						arr_includes(data.types, type) &&
						(data.applicable === undefined ||
							(typeof data.applicable === 'boolean' && data.applicable) ||
							(typeof data.applicable === 'function' && data.applicable(type)))
					);
				})
				.sort((a, b) => {
					return a[1].weight < b[1].weight ? -1 : 1;
				})
				.map(([code, data]) => {
					return { label: data.label, value: code, selected: data.defaultSelected };
				});

		switch (e.target.values) {
			case 'protect':
				field_preset = new Morebits.quickForm.element({ type: 'field', label: 'Preset', name: 'field_preset' });
				field_preset.append({
					type: 'select',
					name: 'category',
					label: msg('choose-preset'),
					event: this.changePreset.bind(this),
					list: mw.config.get('wgArticleId') ? protectionTypes : protectionTypesCreate,
				});

				field2 = new Morebits.quickForm.element({
					type: 'field',
					label: msg('protect-options'),
					name: 'field2',
				});
				field2.append({ type: 'div', name: 'currentprot', label: ' ' }); // holds the current protection
				// level, as filled out by the async
				// callback
				field2.append({ type: 'div', name: 'hasprotectlog', label: ' ' });
				// for existing pages
				if (mw.config.get('wgArticleId')) {
					field2.append({
						type: 'checkbox',
						event: this.formevents.editmodify,
						list: [
							{
								label: msg('protect-edit-modify'),
								name: 'editmodify',
								tooltip: msg('protect-edit-modify-tooltip'),
								checked: true,
							},
						],
					});
					field2.append({
						type: 'select',
						name: 'editlevel',
						label: msg('protect-edit-label'),
						event: this.formevents.editlevel,
						list: protLevelsToQuickformList(protectionLevels, 'edit'),
					});
					field2.append({
						type: 'select',
						name: 'editexpiry',
						label: msg('protectexpiry'),
						event: (e) => {
							if (e.target.value === 'custom') {
								this.doCustomExpiry(e.target);
							}
						},
						// default expiry selection (2 days) is conditionally set in this.changePreset
						list: protectionLengths,
					});
					field2.append({
						type: 'checkbox',
						event: this.formevents.movemodify,
						list: [
							{
								label: msg('protect-move-modify'),
								name: 'movemodify',
								tooltip: msg('protect-move-modify-tooltip'),
								checked: true,
							},
						],
					});
					field2.append({
						type: 'select',
						name: 'movelevel',
						label: msg('protect-move-label'),
						event: this.formevents.movelevel,
						list: protLevelsToQuickformList(protectionLevels, 'move'),
					});
					field2.append({
						type: 'select',
						name: 'moveexpiry',
						label: msg('protectexpiry'),
						event: (e) => {
							if (e.target.value === 'custom') {
								this.doCustomExpiry(e.target);
							}
						},
						// default expiry selection (2 days) is conditionally set in this.changePreset
						list: protectionLengths,
					});
					if (this.hasFlaggedRevs) {
						field2.append({
							type: 'checkbox',
							event: this.formevents.pcmodify,
							list: [
								{
									label: msg('protect-stable-modify'),
									name: 'pcmodify',
									tooltip: msg('protect-stable-modify-tooltip'),
									checked: true,
								},
							],
						});
						field2.append({
							type: 'select',
							name: 'pclevel',
							label: msg('protect-stable-label'),
							event: this.formevents.pclevel,
							list: protLevelsToQuickformList(protectionLevels, 'stable'),
						});
						field2.append({
							type: 'select',
							name: 'pcexpiry',
							label: msg('protectexpiry'),
							event: (e) => {
								if (e.target.value === 'custom') {
									this.doCustomExpiry(e.target);
								}
							},
							// default expiry selection (1 month) is conditionally set in this.changePreset
							list: protectionLengths,
						});
					}
				} else {
					// for non-existing pages
					field2.append({
						type: 'select',
						name: 'createlevel',
						label: msg('protect-create-label'),
						event: this.formevents.createlevel,
						list: protLevelsToQuickformList(protectionLevels, 'create'),
					});
					field2.append({
						type: 'select',
						name: 'createexpiry',
						label: msg('protectexpiry'),
						event: (e) => {
							if (e.target.value === 'custom') {
								this.doCustomExpiry(e.target);
							}
						},
						// default expiry selection (indefinite) is conditionally set in this.changePreset
						list: protectionLengths,
					});
				}
				field2.append({
					type: 'textarea',
					name: 'protectReason',
					label: msg('protect-reason'),
				});
				field2.append({
					type: 'div',
					name: 'protectReason_notes',
					label: msg('protect-notes-label'),
					style: 'display:inline-block; margin-cd top:4px;',
					tooltip: msg('note-requested-tooltip', this.requestPageAcronym),
				});
				field2.append({
					type: 'checkbox',
					event: this.annotateProtectReason.bind(this),
					style: 'display:inline-block; margin-top:4px;',
					list: [
						{
							label: msg('note-requested-label', this.requestPageAcronym),
							name: 'protectReason_notes_rfpp',
							checked: false,
							value: msg('note-requested', this.requestPageAcronym),
						},
					],
				});
				field2.append({
					type: 'input',
					event: this.annotateProtectReason.bind(this),
					label: msg('request-revid-label'),
					name: 'protectReason_notes_rfppRevid',
					tooltip: msg('request-revid-tooltip'),
				});
				if (!this.canTag()) {
					// tagging isn't relevant for non-existing or module pages
					break;
				}
			/* falls through */
			case 'tag':
				field1 = new Morebits.quickForm.element({ type: 'field', label: 'Tagging options', name: 'field1' });
				field1.append({ type: 'div', name: 'currentprot', label: ' ' }); // holds the current protection
				// level, as filled out by the async
				// callback
				field1.append({ type: 'div', name: 'hasprotectlog', label: ' ' });
				field1.append({
					type: 'select',
					name: 'tagtype',
					label: msg('protect-select-tag'),
					list: this.protectionTags,
					event: this.formevents.tagtype,
				});
				field1.append({
					type: 'checkbox',
					list: [
						{
							name: 'small',
							label: msg('protect-tag-small-label'),
							tooltip: msg('protect-tag-small-tooltip'),
							checked: true,
						},
						{
							name: 'noinclude',
							label: msg('protect-tag-noinclude-label'),
							tooltip: msg('protect-tag-noinclude-tooltip'),
							checked: mw.config.get('wgNamespaceNumber') === NS_TEMPLATE,
						},
					],
				});
				break;

			case 'request':
				field_preset = new Morebits.quickForm.element({
					type: 'field',
					label: msg('protect-request-preset-label'),
					name: 'field_preset',
				});
				field_preset.append({
					type: 'select',
					name: 'category',
					label: msg('protect-request-type-label'),
					event: this.changePreset.bind(this),
					list: mw.config.get('wgArticleId') ? protectionTypes : protectionTypesCreate,
				});

				field1 = new Morebits.quickForm.element({ type: 'field', label: 'Options', name: 'field1' });
				field1.append({ type: 'div', name: 'currentprot', label: ' ' }); // holds the current protection
				// level, as filled out by the async
				// callback
				field1.append({ type: 'div', name: 'hasprotectlog', label: ' ' });
				field1.append({
					type: 'select',
					name: 'expiry',
					label: msg('duration-label'),
					list: [
						{ label: '', selected: true, value: '' },
						{ label: msg('temporary'), value: 'Temporary' },
						{ label: msg('protect-expiry-indefinite'), value: 'Indefinite' },
					],
				});
				field1.append({
					type: 'textarea',
					name: 'reason',
					label: msg('reason'),
				});
				break;
			default:
				alert("Something's wrong in twinkleprotect");
				break;
		}

		var oldfield;

		if (field_preset) {
			oldfield = $(e.target.form).find('fieldset[name="field_preset"]')[0];
			oldfield.parentNode.replaceChild(field_preset.render(), oldfield);
		} else {
			$(e.target.form).find('fieldset[name="field_preset"]').css('display', 'none');
		}
		if (field1) {
			oldfield = $(e.target.form).find('fieldset[name="field1"]')[0];
			oldfield.parentNode.replaceChild(field1.render(), oldfield);
		} else {
			$(e.target.form).find('fieldset[name="field1"]').css('display', 'none');
		}
		if (field2) {
			oldfield = $(e.target.form).find('fieldset[name="field2"]')[0];
			oldfield.parentNode.replaceChild(field2.render(), oldfield);
		} else {
			$(e.target.form).find('fieldset[name="field2"]').css('display', 'none');
		}

		if (e.target.values === 'protect') {
			// fake a change event on the preset dropdown
			var evt = document.createEvent('Event');
			evt.initEvent('change', true, true);
			e.target.form.category.dispatchEvent(evt);

			// reduce vertical height of dialog
			$(e.target.form).find('fieldset[name="field2"] select').parent().css({
				display: 'inline-block',
				marginRight: '0.5em',
			});
			$(e.target.form)
				.find('fieldset[name="field2"] input[name="protectReason_notes_rfppRevid"]')
				.parent()
				.css({
					display: 'inline-block',
					marginLeft: '15px',
				})
				.hide();
		}

		// re-add protection level and log info, if it's available
		this.showLogAndCurrentProtectInfo();
	}

	// NOTE: This function is used by batchprotect as well
	formevents = {
		editmodify(e) {
			e.target.form.editlevel.disabled = !e.target.checked;
			e.target.form.editexpiry.disabled = !e.target.checked || e.target.form.editlevel.value === 'all';
			e.target.form.editlevel.style.color = e.target.form.editexpiry.style.color = e.target.checked
				? ''
				: 'transparent';
		},
		editlevel(e) {
			e.target.form.editexpiry.disabled = e.target.value === 'all';
		},
		movemodify(e) {
			// sync move settings with edit settings if applicable
			if (e.target.form.movelevel.disabled && !e.target.form.editlevel.disabled) {
				e.target.form.movelevel.value = e.target.form.editlevel.value;
				e.target.form.moveexpiry.value = e.target.form.editexpiry.value;
			} else if (e.target.form.editlevel.disabled) {
				e.target.form.movelevel.value = 'sysop';
				e.target.form.moveexpiry.value = 'infinity';
			}
			e.target.form.movelevel.disabled = !e.target.checked;
			e.target.form.moveexpiry.disabled = !e.target.checked || e.target.form.movelevel.value === 'all';
			e.target.form.movelevel.style.color = e.target.form.moveexpiry.style.color = e.target.checked
				? ''
				: 'transparent';
		},
		movelevel(e) {
			e.target.form.moveexpiry.disabled = e.target.value === 'all';
		},
		pcmodify(e) {
			e.target.form.pclevel.disabled = !e.target.checked;
			e.target.form.pcexpiry.disabled = !e.target.checked || e.target.form.pclevel.value === 'none';
			e.target.form.pclevel.style.color = e.target.form.pcexpiry.style.color = e.target.checked ? '' : 'transparent';
		},
		pclevel(e) {
			e.target.form.pcexpiry.disabled = e.target.value === 'none';
		},
		createlevel(e) {
			e.target.form.createexpiry.disabled = e.target.value === 'all';
		},
		tagtype(e) {
			e.target.form.small.disabled = e.target.form.noinclude.disabled =
				e.target.value === 'none' || e.target.value === 'noop';
		},
	};

	doCustomExpiry(target) {
		var custom = prompt(msg('custom-expiry-prompt'));
		if (custom) {
			var option = document.createElement('option');
			option.setAttribute('value', custom);
			option.textContent = custom;
			target.appendChild(option);
			target.value = custom;
		} else {
			target.selectedIndex = 0;
		}
	}

	// NOTE: This list is used by batchprotect as well
	getProtectionLevels(): Record<
		string,
		{
			label: string;
			weight: number;
			defaultSelected?: true;
			applicable?: boolean | ((type: string) => boolean);
			types: ('edit' | 'move' | 'create' | 'stable')[];
		}
	> {
		return {
			all: {
				label: msg('all-users'),
				weight: 0,
				types: ['edit', 'move', 'create', 'stable'],
			},
			autoconfirmed: {
				label: msg('group-autoconfirmed'),
				weight: 10,
				types: ['edit', 'create', 'stable'],
			},
			sysop: {
				label: msg('group-sysop'),
				defaultSelected: true,
				weight: 40,
				types: ['edit', 'move', 'create', 'stable'],
			},
		};
	}

	// default expiry selection is conditionally set in this.changePreset
	// NOTE: This list is used by batchprotect as well
	getProtectionLengths() {
		return [
			{ label: msg('duration-hours', 1), value: '1 hour' },
			{ label: msg('duration-hours', 2), value: '2 hours' },
			{ label: msg('duration-hours', 3), value: '3 hours' },
			{ label: msg('duration-hours', 6), value: '6 hours' },
			{ label: msg('duration-hours', 12), value: '12 hours' },
			{ label: msg('duration-days', 1), value: '1 day' },
			{ label: msg('duration-days', 2), value: '2 days' },
			{ label: msg('duration-days', 3), value: '3 days' },
			{ label: msg('duration-days', 4), value: '4 days' },
			{ label: msg('duration-weeks', 1), value: '1 week' },
			{ label: msg('duration-weeks', 2), value: '2 weeks' },
			{ label: msg('duration-months', 1), value: '1 month' },
			{ label: msg('duration-months', 2), value: '2 months' },
			{ label: msg('duration-months', 3), value: '3 months' },
			{ label: msg('duration-years', 1), value: '1 year' },
			{ label: msg('protect-expiry-indefinite'), value: 'infinity' },
			{ label: msg('custom-expiry-label'), value: 'custom' },
		];
	}

	abstract getProtectionPresets(): quickFormElementData[];

	abstract getCreateProtectionPresets(): quickFormElementData[];

	protectionPresetsInfo: Record<
		string,
		{
			edit?: string;
			move?: string;
			reason?: string;
			expiry?: string;
			template?: string;
			stabilize?: string;
			create?: string;
		}
	> = {};

	protectionTags: quickFormElementData[] = [];

	changePreset(e) {
		var form = e.target.form;

		var actiontypes = form.actiontype;
		var actiontype;
		for (var i = 0; i < actiontypes.length; i++) {
			if (!actiontypes[i].checked) {
				continue;
			}
			actiontype = actiontypes[i].values;
			break;
		}

		if (actiontype === 'protect') {
			// actually protecting the page
			var item = this.protectionPresetsInfo[form.category.value];

			// Check if page exists
			if (mw.config.get('wgArticleId')) {
				if (item.edit) {
					form.editmodify.checked = true;
					this.formevents.editmodify({ target: form.editmodify });
					form.editlevel.value = item.edit;
					this.formevents.editlevel({ target: form.editlevel });
				} else {
					form.editmodify.checked = false;
					this.formevents.editmodify({ target: form.editmodify });
				}

				if (item.move) {
					form.movemodify.checked = true;
					this.formevents.movemodify({ target: form.movemodify });
					form.movelevel.value = item.move;
					this.formevents.movelevel({ target: form.movelevel });
				} else {
					form.movemodify.checked = false;
					this.formevents.movemodify({ target: form.movemodify });
				}

				form.editexpiry.value = form.moveexpiry.value = item.expiry || '2 days';

				if (form.pcmodify) {
					if (item.stabilize) {
						form.pcmodify.checked = true;
						this.formevents.pcmodify({ target: form.pcmodify });
						form.pclevel.value = item.stabilize;
						this.formevents.pclevel({ target: form.pclevel });
					} else {
						form.pcmodify.checked = false;
						this.formevents.pcmodify({ target: form.pcmodify });
					}
					form.pcexpiry.value = item.expiry || '1 month';
				}
			} else {
				if (item.create) {
					form.createlevel.value = item.create;
					this.formevents.createlevel({ target: form.createlevel });
				}
				form.createexpiry.value = item.expiry || 'infinity';
			}

			var reasonField = actiontype === 'protect' ? form.protectReason : form.reason;
			if (item.reason) {
				reasonField.value = item.reason;
			} else {
				reasonField.value = '';
			}
			// Add any annotations
			this.annotateProtectReason(e);

			// sort out tagging options, disabled if nonexistent or lua
			if (this.canTag()) {
				if (form.category.value === 'unprotect') {
					form.tagtype.value = 'none';
				} else {
					form.tagtype.value = item.template ? item.template : form.category.value;
				}
				this.formevents.tagtype({ target: form.tagtype });

				// We only have one TE template at the moment, so this
				// should be expanded if more are added (e.g. pp-semi-template)
				if (form.category.value === 'pp-template') {
					// XXX: i18n
					form.noinclude.checked = true;
				} else if (mw.config.get('wgNamespaceNumber') !== NS_TEMPLATE) {
					form.noinclude.checked = false;
				}
			}
		} else {
			// RPP request
			if (form.category.value === 'unprotect') {
				form.expiry.value = '';
				form.expiry.disabled = true;
			} else {
				form.expiry.value = '';
				form.expiry.disabled = false;
			}
		}
	}

	protectReasonAnnotations = [];

	annotateProtectReason(e) {
		var form = e.target.form;
		var checkbox = e.target;
		var protectReason = form.protectReason.value.replace(
			new RegExp(
				'(?:' +
					msg('semicolon-separator') +
					')?' +
					mw.util.escapeRegExp(this.protectReasonAnnotations.join(msg('colon-separator')))
			),
			''
		);

		if (checkbox.name === 'protectReason_notes_rfpp') {
			if (checkbox.checked) {
				this.protectReasonAnnotations.push(checkbox.value);
				$(form.protectReason_notes_rfppRevid).parent().show();
			} else {
				this.protectReasonAnnotations = [];
				form.protectReason_notes_rfppRevid.value = '';
				$(form.protectReason_notes_rfppRevid).parent().hide();
			}
		} else if (checkbox.name === 'protectReason_notes_rfppRevid') {
			this.protectReasonAnnotations = this.protectReasonAnnotations.filter(
				(el) => !str_startsWith(el, '[[' + SiteConfig.permalinkSpecialPageName)
			);
			if (e.target.value.length) {
				var permalink =
					'[[' + SiteConfig.permalinkSpecialPageName + '/' + e.target.value + '#' + Morebits.pageNameNorm + ']]';
				this.protectReasonAnnotations.push(permalink);
			}
		}

		if (!this.protectReasonAnnotations.length) {
			form.protectReason.value = protectReason;
		} else {
			form.protectReason.value =
				(protectReason ? protectReason + msg('semicolon-separator') : '') +
				this.protectReasonAnnotations.join(msg('colon-separator'));
		}
	}

	canTag() {
		return mw.config.get('wgArticleId') && mw.config.get('wgPageContentModel') !== 'Scribunto';
	}

	evaluate(e) {
		var form = e.target;
		var input = Morebits.quickForm.getInputData(form) as {
			actiontype: 'tag' | 'protect' | 'request';
			tagtype: string;
			small: boolean;
			noinclude: boolean;
			editmodify: boolean;
			editlevel: string;
			editexpiry: string;
			movemodify: boolean;
			movelevel: string;
			moveexpiry: string;
			createlevel: string;
			createexpiry: string;
			protectReason: string;
			protectReason_notes_rfppRevid: string;
			pcmodify: boolean;
			pclevel: string;
			pcexpiry: string;

			// while requesting
			category: string;
			reason: string;
			expiry: string;
		};

		var tagparams;
		if (input.actiontype === 'tag' || (input.actiontype === 'protect' && this.canTag())) {
			tagparams = {
				tag: input.tagtype,
				reason:
					// XXX: i18n
					(input.tagtype === 'pp-protected' || input.tagtype === 'pp-semi-protected' || input.tagtype === 'pp-move') &&
					input.protectReason,
				small: input.small,
				noinclude: input.noinclude,
			};
		}

		switch (input.actiontype) {
			case 'protect':
				// protect the page
				Morebits.wiki.actionCompleted.redirect = mw.config.get('wgPageName');
				Morebits.wiki.actionCompleted.notice = 'Protection complete';

				var statusInited = false;
				var thispage;

				var allDone = () => {
					if (thispage) {
						thispage.getStatusElement().info('done');
					}
					if (tagparams) {
						this.taggingPage(tagparams);
					}
				};

				var protectIt = (next) => {
					thispage = new Morebits.wiki.page(mw.config.get('wgPageName'), 'Protecting page');
					if (mw.config.get('wgArticleId')) {
						if (input.editmodify) {
							thispage.setEditProtection(input.editlevel, input.editexpiry);
						}
						if (input.movemodify) {
							// Ensure a level has actually been chosen
							if (input.movelevel) {
								thispage.setMoveProtection(input.movelevel, input.moveexpiry);
							} else {
								alert('You must chose a move protection level!');
								return;
							}
						}
						thispage.setWatchlist(getPref('watchProtectedPages'));
					} else {
						thispage.setCreateProtection(input.createlevel, input.createexpiry);
						thispage.setWatchlist(false);
					}

					if (input.protectReason) {
						thispage.setEditSummary(input.protectReason);
					} else {
						alert('You must enter a protect reason, which will be inscribed into the protection log.');
						return;
					}

					if (input.protectReason_notes_rfppRevid && !/^\d+$/.test(input.protectReason_notes_rfppRevid)) {
						alert(
							'The provided revision ID is malformed. Please see https://en.wikipedia.org/wiki/Help:Permanent_link for information on how to find the correct ID (also called "oldid").'
						);
						return;
					}

					if (!statusInited) {
						Morebits.simpleWindow.setButtonsEnabled(false);
						Morebits.status.init(form);
						statusInited = true;
					}

					thispage.setChangeTags(Twinkle.changeTags);
					thispage.protect(next);
				};

				var stabilizeIt = () => {
					if (thispage) {
						thispage.getStatusElement().info('done');
					}

					thispage = new Morebits.wiki.page(mw.config.get('wgPageName'), 'Applying pending changes protection');
					thispage.setFlaggedRevs(input.pclevel, input.pcexpiry);

					if (input.protectReason) {
						thispage.setEditSummary(input.protectReason + Twinkle.summaryAd); // flaggedrevs tag support:
						// [[phab:T247721]]
					} else {
						alert('You must enter a protect reason, which will be inscribed into the protection log.');
						return;
					}

					if (!statusInited) {
						Morebits.simpleWindow.setButtonsEnabled(false);
						Morebits.status.init(form);
						statusInited = true;
					}

					thispage.setWatchlist(getPref('watchProtectedPages'));
					thispage.stabilize(allDone, (error) => {
						if (error.errorCode === 'stabilize_denied') {
							// [[phab:T234743]]
							thispage
								.getStatusElement()
								.error(
									'Failed trying to modify pending changes settings, likely due to a mediawiki bug. Other actions (tagging or regular protection) may have taken place. Please reload the page and try again.'
								);
						}
					});
				};

				if (input.editmodify || input.movemodify || !mw.config.get('wgArticleId')) {
					if (input.pcmodify) {
						protectIt(stabilizeIt);
					} else {
						protectIt(allDone);
					}
				} else if (input.pcmodify) {
					stabilizeIt();
				} else {
					alert(
						"Please give Twinkle something to do! \nIf you just want to tag the page, you can choose the 'Tag page with protection template' option at the top."
					);
				}

				break;

			case 'tag':
				// apply a protection template

				Morebits.simpleWindow.setButtonsEnabled(false);
				Morebits.status.init(form);

				Morebits.wiki.actionCompleted.redirect = mw.config.get('wgPageName');
				Morebits.wiki.actionCompleted.followRedirect = false;
				Morebits.wiki.actionCompleted.notice = 'Tagging complete';

				this.taggingPage(tagparams);
				break;

			case 'request':
				// file request at RFPP

				// validation
				if (input.category === 'unprotect') {
					var admins = $.map(this.currentProtectionLevels, (pl) => {
						if (!pl.admin || SiteConfig.botUsernameRegex.test(pl.admin)) {
							return null;
						}
						return pl.admin;
					});
					if (admins.length && !confirm(msg('sysops-contacted', Morebits.array.uniq(admins)))) {
						return false;
					}
				}

				Morebits.simpleWindow.setButtonsEnabled(false);
				Morebits.status.init(form);

				// Updating data for the action completed event
				Morebits.wiki.actionCompleted.redirect = this.requestPageName;
				Morebits.wiki.actionCompleted.notice = 'Nomination completed, redirecting now to the discussion page';

				var rppPage = new Page(this.requestPageName, 'Requesting protection of page');
				rppPage.setFollowRedirect(true);
				rppPage.load().then(() => this.fileRequest(rppPage, input));
				break;

			default:
				alert('twinkleprotect: unknown kind of action');
				break;
		}
	}

	private getTypeNameAndReason(list, selection, parentLabel?): [string, string] {
		for (let i of list) {
			if (i.list) {
				let result = this.getTypeNameAndReason(i.list, selection, i.label);
				if (result) {
					return result;
				}
			} else if (i.value === selection) {
				return [parentLabel || i.label, i.reason];
			}
		}
	}

	/**
	 * Regex that matches protection tags already existing on the page.
	 * Leaving this as null (default) means that no existing tag detection takes place.
	 */
	existingTagRegex: RegExp | null = null;

	/**
	 * Regex matching the redirect category shell template whose existence removes the need
	 * to add a protection template to the redirect since the shell auto-detects it.
	 * This should be null if the wiki has no such template.
	 */
	disableTaggingOnRedirectTemplateRegex: RegExp | null = null;

	taggingPage(params) {
		if (params.tag === 'noop') {
			Morebits.status.info(msg('protect-tag-adding'), msg('protect-tag-none-status'));
			return;
		}

		var protectedPage = new Page(mw.config.get('wgPageName'), msg('protect-tag-adding'));
		return protectedPage.load().then(() => {
			var text = protectedPage.getPageText();
			var summary;

			if (this.existingTagRegex) {
				var re_result = this.existingTagRegex.exec(text);
				if (re_result) {
					if (params.tag === 'none' || confirm(msg('protect-tag-exists-prompt', re_result[1]))) {
						text = text.replace(this.existingTagRegex, '');
					}
				}
			}

			if (params.tag === 'none') {
				summary = msg('protect-tag-removing');
			} else {
				let tag = makeTemplate(params.tag, {
					reason: params.reason,
					small: params.small ? 'yes' : null,
				});

				if (isTextRedirect(text)) {
					// redirect page
					// Only tag if no {{rcat shell}} is found
					if (!this.disableTaggingOnRedirectTemplateRegex || !text.match(this.disableTaggingOnRedirectTemplateRegex)) {
						text = text.replace(/^\s*#(\w+) ?(\[\[.*?\]\])(.*)/i, '#$1 $2$3\n\n' + tag);
					} else {
						Morebits.status.info(msg('protect-tag-abort'), msg('nothing-to-do'));
						return $.Deferred().resolve();
					}
				} else {
					if (params.noinclude) {
						tag = '<noinclude>' + tag + '</noinclude>';
					} else {
						tag = tag + '\n';
					}

					text = this.insertTagIntoPage(text, tag);
				}
				summary = 'Adding {{' + params.tag + '}}';
			}

			protectedPage.setEditSummary(summary);
			protectedPage.setWatchlist(getPref('watchPPTaggedPages'));
			protectedPage.setPageText(text);
			protectedPage.setCreateOption('nocreate');
			protectedPage.suppressProtectWarning(); // no need to let admins know they are editing through protection
			return protectedPage.save();
		});
	}

	/**
	 * Insert tag into the page.
	 * You may want to override this to have the tag inserted after short description or hatnotes
	 * @param text
	 * @param tag
	 */
	insertTagIntoPage(text: string, tag: string) {
		return tag + '\n' + text;
	}

	/**
	 * Regex expression to search for an existing request on the request page, and abort if
	 * found. Leaving this null (default) means that no check for existing request is performed.
	 */
	existingRequestRegex: RegExp | null = null;

	/**
	 * Returns the request text and edit summary.
	 * @param input
	 * @returns {string[]} - the first string is the request text, second string is the edit
	 * summary
	 */
	getRequestTextAndSummary(input): [string, string] {
		let [typename, typereason] = this.getTypeNameAndReason(this.getProtectionPresets(), input.category);
		var reason = typereason;
		if (input.reason) {
			if (typereason) {
				reason += '\u00A0\u2013 '; // U+00A0 NO-BREAK SPACE; U+2013 EN RULE
			}
			reason += input.reason;
		}
		if (reason && !str_endsWith(reason, '.')) {
			reason += '.';
		}

		var text = '=== [[:' + Morebits.pageNameNorm + ']] ===\n';
		text += '* {{pagelinks|1=' + Morebits.pageNameNorm + '}}\n\n';

		var words = input.expiry ? input.expiry + ' ' : '' + typename;

		text +=
			"'''" +
			Morebits.string.toUpperCaseFirstChar(words) +
			(reason ? ":''' " + Morebits.string.formatReasonText(reason) : ".'''") +
			' ~~~~';

		let summary = `/* ${Morebits.pageNameNorm} */ Requesting ${typename}${
			typename === 'pending changes' ? ' on [[:' : ' of [[:'
		}${Morebits.pageNameNorm}]].`;

		return [text, summary];
	}

	fileRequest(rppPage: Page, input: { category: string; reason: string; expiry: string }) {
		var text = rppPage.getPageText();
		var statusElement = rppPage.getStatusElement();

		if (this.existingRequestRegex && this.existingRequestRegex.exec(text)) {
			statusElement.error(msg('protect-request-exists', rppPage.getPageName()));
			return;
		}

		let [requestText, summary] = this.getRequestTextAndSummary(input);

		// If either protection type results in a increased status, then post it under increase
		// else we post it under decrease
		var increase = false;
		var protInfo = this.protectionPresetsInfo[input.category];

		// function to compute protection weights (see comment at this.protectionWeight)
		let protectionLevels = this.getProtectionLevels();
		var computeWeight = (mainLevel, stabilizeLevel?) => {
			var result = protectionLevels[mainLevel || 'all'].weight;
			if (stabilizeLevel) {
				if (result) {
					if (stabilizeLevel.level === 'autoconfirmed') {
						result += 2;
					}
				} else {
					result = protectionLevels[stabilizeLevel].weight / 2;
				}
			}
			return result;
		};

		// compare the page's current protection weights with the protection we are requesting
		var editWeight = computeWeight(
			this.currentProtectionLevels.edit?.level,
			this.currentProtectionLevels.stabilize?.level
		);
		if (
			computeWeight(protInfo.edit, protInfo.stabilize) > editWeight ||
			computeWeight(protInfo.move) > computeWeight(this.currentProtectionLevels.move?.level) ||
			computeWeight(protInfo.create) > computeWeight(this.currentProtectionLevels.create?.level)
		) {
			increase = true;
		}

		var reg;
		if (increase) {
			reg = /(\n==\s*Current requests for reduction in protection level\s*==)/;
		} else {
			reg = /(\n==\s*Current requests for edits to a protected page\s*==)/;
		}

		var originalTextLength = text.length;
		text = text.replace(reg, '\n' + requestText + '\n$1');
		if (text.length === originalTextLength) {
			statusElement.error(
				'Could not find relevant heading on WP:RPP. To fix this problem, please see [[Wikipedia:Twinkle/Fixing RPP|How to fix RPP]].'
			);
			return;
		}
		statusElement.status('Adding new request...');
		rppPage.setEditSummary(summary);
		rppPage.setPageText(text);
		rppPage.setCreateOption('recreate');
		return rppPage.save().then(() => {
			// Watch the page being requested
			var watchPref = getPref('watchRequestedPages');
			// action=watch has no way to rely on user preferences (T262912), so we do it manually.
			// The watchdefault pref appears to reliably return '1' (string),
			// but that's not consistent among prefs so might as well be "correct"
			var watch =
				watchPref !== 'no' && (watchPref !== 'default' || !!parseInt(mw.user.options.get('watchdefault'), 10));
			if (watch) {
				var watch_query = {
					action: 'watch',
					titles: mw.config.get('wgPageName'),
					token: mw.user.tokens.get('watchToken'),
					// Only add the expiry if page is unwatched or already temporarily watched
					expiry: this.watched !== true && watchPref !== 'default' && watchPref !== 'yes' ? watchPref : undefined,
				};
				return new Api('Adding requested page to watchlist', watch_query).post();
			}
		});
	}
}

function link(displaytext: string, title: string, params?: any) {
	return `<a target="_blank" href="${mw.util.getUrl(title, params)}">${displaytext}</a>`;
}
