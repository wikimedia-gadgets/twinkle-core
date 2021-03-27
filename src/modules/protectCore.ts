import { Dialog } from '../Dialog';
import { LogEvent } from '../utils';
import { TwinkleModule } from '../twinkleModule';
import { Twinkle } from '../twinkle';
import { getPref } from '../Config';
// XXX
import { hatnoteRegex } from '../../../twinkle-enwiki/src/common';

export class ProtectCore extends TwinkleModule {
	moduleName = 'protect';
	static moduleName = 'protect';

	portletName = Morebits.userIsSysop ? 'PP' : 'RPP';
	portletId = 'twinkle-protect';
	portletTooltip = Morebits.userIsSysop ? 'Protect page' : 'Request page protection';
	windowTitle = Morebits.userIsSysop ? 'Apply, request or tag page protection' : 'Request or tag page protection';

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
			label: 'Type of action',
		});
		actionfield.append({
			type: 'radio',
			name: 'actiontype',
			event: this.changeAction.bind(this),
			list: [
				{
					label: 'Protect page',
					value: 'protect',
					tooltip: 'Apply actual protection to the page.',
					checked: true,
					adminonly: true,
				},
				{
					label: 'Request page protection',
					value: 'request',
					tooltip:
						'If you want to request protection via WP:RPP' +
						(Morebits.userIsSysop ? ' instead of doing the protection by yourself.' : '.'),
					checked: !Morebits.userIsSysop,
				},
				{
					label: 'Tag page with protection template',
					value: 'tag',
					tooltip:
						'If the protecting admin forgot to apply a protection template, or you have just protected the page without tagging, you can use this to apply the appropriate protection tag.',
					disabled: mw.config.get('wgArticleId') === 0 || mw.config.get('wgPageContentModel') === 'Scribunto',
				},
			],
		});

		form.append({ type: 'field', label: 'Preset', name: 'field_preset' });
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

	// A list of bots who may be the protecting sysop, for whom we shouldn't
	// remind the user contact before requesting unprotection (evaluate)
	trustedBots = ['MusikBot II', 'TFA Protector Bot'];

	// Check if FlaggedRevs extension is enabled
	hasFlaggedRevs =
		mw.loader.getState('ext.flaggedRevs.review') &&
		// FlaggedRevs only valid in some namespaces, hardcoded until [[phab:T218479]]
		(mw.config.get('wgNamespaceNumber') === 0 || mw.config.get('wgNamespaceNumber') === 4);

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
		var protectDeferred = api.get({
			format: 'json',
			indexpageids: true,
			action: 'query',
			list: 'logevents',
			letype: 'protect',
			letitle: mw.config.get('wgPageName'),
			prop: this.hasFlaggedRevs ? 'info|flagged' : 'info',
			inprop: 'protection|watched',
			titles: mw.config.get('wgPageName'),
		});
		var stableDeferred = api.get({
			format: 'json',
			action: 'query',
			list: 'logevents',
			letype: 'stable',
			letitle: mw.config.get('wgPageName'),
		});

		var earlyDecision = [protectDeferred];
		if (this.hasFlaggedRevs) {
			earlyDecision.push(stableDeferred);
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

			if (page.flagged) {
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
	protectLog: LogEvent[];
	stableLog: LogEvent[];

	showLogAndCurrentProtectInfo() {
		var currentlyProtected = !$.isEmptyObject(this.currentProtectionLevels);

		if (this.hasProtectLog || this.hasStableLog) {
			var $linkMarkup = $('<span>');

			if (this.hasProtectLog) {
				$linkMarkup.append(
					$(
						'<a target="_blank" href="' +
							mw.util.getUrl('Special:Log', {
								action: 'view',
								page: mw.config.get('wgPageName'),
								type: 'protect',
							}) +
							'">protection log</a>'
					)
				);
				if (!currentlyProtected || (!this.currentProtectionLevels.edit && !this.currentProtectionLevels.move)) {
					var lastProtectAction = this.protectLog[0];
					if (lastProtectAction.action === 'unprotect') {
						$linkMarkup.append(' (unprotected ' + new Morebits.date(lastProtectAction.timestamp).calendar('utc') + ')');
					} else {
						// protect or modify
						$linkMarkup.append(
							' (expired ' + new Morebits.date(lastProtectAction.params.details[0].expiry).calendar('utc') + ')'
						);
					}
				}
				$linkMarkup.append(this.hasStableLog ? $('<span> &bull; </span>') : null);
			}

			if (this.hasStableLog) {
				$linkMarkup.append(
					$(
						'<a target="_blank" href="' +
							mw.util.getUrl('Special:Log', {
								action: 'view',
								page: mw.config.get('wgPageName'),
								type: 'stable',
							}) +
							'">pending changes log</a>)'
					)
				);
				if (!currentlyProtected || !this.currentProtectionLevels.stabilize) {
					var lastStabilizeAction = this.stableLog[0];
					if (lastStabilizeAction.action === 'reset') {
						$linkMarkup.append(' (reset ' + new Morebits.date(lastStabilizeAction.timestamp).calendar('utc') + ')');
					} else {
						// config or modify
						$linkMarkup.append(
							' (expired ' + new Morebits.date(lastStabilizeAction.params.expiry).calendar('utc') + ')'
						);
					}
				}
			}

			Morebits.status.init($('div[name="hasprotectlog"] span')[0]);
			Morebits.status.warn(
				currentlyProtected ? 'Previous protections' : 'This page has been protected in the past',
				$linkMarkup[0]
			);
		}

		Morebits.status.init($('div[name="currentprot"] span')[0]);
		var protectionNode = [],
			statusLevel = 'info';

		if (currentlyProtected) {
			$.each(this.currentProtectionLevels, (type, settings) => {
				var label = type === 'stabilize' ? 'Pending Changes' : Morebits.string.toUpperCaseFirstChar(type);

				if (type === 'cascading') {
					// Covered by another page
					label = 'Cascading protection ';
					protectionNode.push($('<b>' + label + '</b>')[0]);
					if (settings.source) {
						// Should by definition exist
						var sourceLink =
							'<a target="_blank" href="' + mw.util.getUrl(settings.source) + '">' + settings.source + '</a>';
						protectionNode.push($('<span>from ' + sourceLink + '</span>')[0]);
					}
				} else {
					var level = settings.level;
					// Make cascading protection more prominent
					if (settings.cascade) {
						level += ' (cascading)';
					}
					protectionNode.push($('<b>' + label + ': ' + level + '</b>')[0]);
				}

				if (settings.expiry === 'infinity') {
					protectionNode.push(' (indefinite) ');
				} else {
					protectionNode.push(' (expires ' + new Morebits.date(settings.expiry).calendar('utc') + ') ');
				}
				if (settings.admin) {
					var adminLink =
						'<a target="_blank" href="' +
						mw.util.getUrl('User talk:' + settings.admin) +
						'">' +
						settings.admin +
						'</a>';
					protectionNode.push($('<span>by ' + adminLink + '</span>')[0]);
				}
				protectionNode.push($('<span> \u2022 </span>')[0]);
			});
			protectionNode = protectionNode.slice(0, -1); // remove the trailing bullet
			statusLevel = 'warn';
		} else {
			protectionNode.push($('<b>no protection</b>')[0]);
		}

		Morebits.status[statusLevel]('Current protection level', protectionNode);
	}

	changeAction(e) {
		var field_preset;
		var field1;
		var field2;

		switch (e.target.values) {
			case 'protect':
				field_preset = new Morebits.quickForm.element({ type: 'field', label: 'Preset', name: 'field_preset' });
				field_preset.append({
					type: 'select',
					name: 'category',
					label: 'Choose a preset:',
					event: this.changePreset.bind(this),
					list: mw.config.get('wgArticleId') ? this.protectionTypes : this.protectionTypesCreate,
				});

				field2 = new Morebits.quickForm.element({ type: 'field', label: 'Protection options', name: 'field2' });
				field2.append({ type: 'div', name: 'currentprot', label: ' ' }); // holds the current protection
				// level, as filled out by the async
				// callback
				field2.append({ type: 'div', name: 'hasprotectlog', label: ' ' });
				// for existing pages
				if (mw.config.get('wgArticleId')) {
					field2.append({
						type: 'checkbox',
						event: this.formevents.editmodify.bind(this),
						list: [
							{
								label: 'Modify edit protection',
								name: 'editmodify',
								tooltip: 'If this is turned off, the edit protection level, and expiry time, will be left as is.',
								checked: true,
							},
						],
					});
					field2.append({
						type: 'select',
						name: 'editlevel',
						label: 'Edit protection:',
						event: this.formevents.editlevel.bind(this),
						list: this.protectionLevels.filter((level) => {
							// Filter TE outside of templates and modules
							return this.isTemplate || level.value !== 'templateeditor';
						}),
					});
					field2.append({
						type: 'select',
						name: 'editexpiry',
						label: 'Expires:',
						event: (e) => {
							if (e.target.value === 'custom') {
								this.doCustomExpiry(e.target);
							}
						},
						// default expiry selection (2 days) is conditionally set in this.changePreset
						list: this.protectionLengths,
					});
					field2.append({
						type: 'checkbox',
						event: this.formevents.movemodify.bind(this),
						list: [
							{
								label: 'Modify move protection',
								name: 'movemodify',
								tooltip: 'If this is turned off, the move protection level, and expiry time, will be left as is.',
								checked: true,
							},
						],
					});
					field2.append({
						type: 'select',
						name: 'movelevel',
						label: 'Move protection:',
						event: this.formevents.movelevel.bind(this),
						list: this.protectionLevels.filter((level) => {
							// Autoconfirmed is required for a move, redundant
							return level.value !== 'autoconfirmed' && (this.isTemplate || level.value !== 'templateeditor');
						}),
					});
					field2.append({
						type: 'select',
						name: 'moveexpiry',
						label: 'Expires:',
						event: (e) => {
							if (e.target.value === 'custom') {
								this.doCustomExpiry(e.target);
							}
						},
						// default expiry selection (2 days) is conditionally set in this.changePreset
						list: this.protectionLengths,
					});
					if (this.hasFlaggedRevs) {
						field2.append({
							type: 'checkbox',
							event: this.formevents.pcmodify.bind(this),
							list: [
								{
									label: 'Modify pending changes protection',
									name: 'pcmodify',
									tooltip: 'If this is turned off, the pending changes level, and expiry time, will be left as is.',
									checked: true,
								},
							],
						});
						field2.append({
							type: 'select',
							name: 'pclevel',
							label: 'Pending changes:',
							event: this.formevents.pclevel.bind(this),
							list: [
								{ label: 'None', value: 'none' },
								{ label: 'Pending change', value: 'autoconfirmed', selected: true },
							],
						});
						field2.append({
							type: 'select',
							name: 'pcexpiry',
							label: 'Expires:',
							event: (e) => {
								if (e.target.value === 'custom') {
									this.doCustomExpiry(e.target);
								}
							},
							// default expiry selection (1 month) is conditionally set in this.changePreset
							list: this.protectionLengths,
						});
					}
				} else {
					// for non-existing pages
					field2.append({
						type: 'select',
						name: 'createlevel',
						label: 'Create protection:',
						event: this.formevents.createlevel.bind(this),
						list: this.protectionLevels.filter((level) => {
							// Filter TE always, and autoconfirmed in mainspace, redundant since WP:ACPERM
							return (
								level.value !== 'templateeditor' &&
								(mw.config.get('wgNamespaceNumber') !== 0 || level.value !== 'autoconfirmed')
							);
						}),
					});
					field2.append({
						type: 'select',
						name: 'createexpiry',
						label: 'Expires:',
						event: (e) => {
							if (e.target.value === 'custom') {
								this.doCustomExpiry(e.target);
							}
						},
						// default expiry selection (indefinite) is conditionally set in this.changePreset
						list: this.protectionLengths,
					});
				}
				field2.append({
					type: 'textarea',
					name: 'protectReason',
					label: 'Reason (for protection log):',
				});
				field2.append({
					type: 'div',
					name: 'protectReason_notes',
					label: 'Notes:',
					style: 'display:inline-block; margin-top:4px;',
					tooltip: 'Add a note to the protection log that this was requested at RfPP.',
				});
				field2.append({
					type: 'checkbox',
					event: this.annotateProtectReason.bind(this),
					style: 'display:inline-block; margin-top:4px;',
					list: [
						{
							label: 'RfPP request',
							name: 'protectReason_notes_rfpp',
							checked: false,
							value: 'requested at [[WP:RfPP]]',
						},
					],
				});
				field2.append({
					type: 'input',
					event: this.annotateProtectReason.bind(this),
					label: 'RfPP revision ID',
					name: 'protectReason_notes_rfppRevid',
					value: '',
					tooltip: 'Optional revision ID of the RfPP page where protection was requested.',
				});
				if (!mw.config.get('wgArticleId') || mw.config.get('wgPageContentModel') === 'Scribunto') {
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
					label: 'Choose protection template:',
					list: this.protectionTags,
					event: this.formevents.tagtype,
				});
				field1.append({
					type: 'checkbox',
					list: [
						{
							name: 'small',
							label: 'Iconify (small=yes)',
							tooltip: 'Will use the |small=yes feature of the template, and only render it as a keylock',
							checked: true,
						},
						{
							name: 'noinclude',
							label: 'Wrap protection template with <noinclude>',
							tooltip: "Will wrap the protection template in &lt;noinclude&gt; tags, so that it won't transclude",
							checked: mw.config.get('wgNamespaceNumber') === 10,
						},
					],
				});
				break;

			case 'request':
				field_preset = new Morebits.quickForm.element({
					type: 'field',
					label: 'Type of protection',
					name: 'field_preset',
				});
				field_preset.append({
					type: 'select',
					name: 'category',
					label: 'Type and reason:',
					event: this.changePreset.bind(this),
					list: mw.config.get('wgArticleId') ? this.protectionTypes : this.protectionTypesCreate,
				});

				field1 = new Morebits.quickForm.element({ type: 'field', label: 'Options', name: 'field1' });
				field1.append({ type: 'div', name: 'currentprot', label: ' ' }); // holds the current protection
				// level, as filled out by the async
				// callback
				field1.append({ type: 'div', name: 'hasprotectlog', label: ' ' });
				field1.append({
					type: 'select',
					name: 'expiry',
					label: 'Duration: ',
					list: [
						{ label: '', selected: true, value: '' },
						{ label: 'Temporary', value: 'temporary' },
						{ label: 'Indefinite', value: 'infinity' },
					],
				});
				field1.append({
					type: 'textarea',
					name: 'reason',
					label: 'Reason: ',
				});
				break;
			default:
				alert("Something's afoot in twinkleprotect");
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
		var custom = prompt(
			'Enter a custom expiry time.  \nYou can use relative times, like "1 minute" or "19 days", or absolute timestamps, "yyyymmddhhmm" (e.g. "200602011405" is Feb 1, 2006, at 14:05 UTC).',
			''
		);
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
	protectionLevels = [
		{ label: 'All', value: 'all' },
		{ label: 'Autoconfirmed', value: 'autoconfirmed' },
		{ label: 'Extended confirmed', value: 'extendedconfirmed' },
		{ label: 'Template editor', value: 'templateeditor' },
		{ label: 'Sysop', value: 'sysop', selected: true },
	];

	// default expiry selection is conditionally set in this.changePreset
	// NOTE: This list is used by batchprotect as well
	protectionLengths = [
		{ label: '1 hour', value: '1 hour' },
		{ label: '2 hours', value: '2 hours' },
		{ label: '3 hours', value: '3 hours' },
		{ label: '6 hours', value: '6 hours' },
		{ label: '12 hours', value: '12 hours' },
		{ label: '1 day', value: '1 day' },
		{ label: '2 days', value: '2 days' },
		{ label: '3 days', value: '3 days' },
		{ label: '4 days', value: '4 days' },
		{ label: '1 week', value: '1 week' },
		{ label: '2 weeks', value: '2 weeks' },
		{ label: '1 month', value: '1 month' },
		{ label: '2 months', value: '2 months' },
		{ label: '3 months', value: '3 months' },
		{ label: '1 year', value: '1 year' },
		{ label: 'indefinite', value: 'infinity' },
		{ label: 'Custom...', value: 'custom' },
	];

	protectionTypes = [
		{ label: 'Unprotection', value: 'unprotect' },
		{
			label: 'Full protection',
			list: [
				{ label: 'Generic (full)', value: 'pp-protected' },
				{ label: 'Content dispute/edit warring (full)', value: 'pp-dispute' },
				{ label: 'Persistent vandalism (full)', value: 'pp-vandalism' },
				{ label: 'User talk of blocked user (full)', value: 'pp-usertalk' },
			],
		},
		{
			label: 'Template protection',
			list: [{ label: 'Highly visible template (TE)', value: 'pp-template' }],
		},
		{
			label: 'Extended confirmed protection',
			list: [
				{ label: 'Arbitration enforcement (ECP)', selected: true, value: 'pp-30-500-arb' },
				{ label: 'Persistent vandalism (ECP)', value: 'pp-30-500-vandalism' },
				{ label: 'Disruptive editing (ECP)', value: 'pp-30-500-disruptive' },
				{ label: 'BLP policy violations (ECP)', value: 'pp-30-500-blp' },
				{ label: 'Sockpuppetry (ECP)', value: 'pp-30-500-sock' },
			],
		},
		{
			label: 'Semi-protection',
			list: [
				{ label: 'Generic (semi)', value: 'pp-semi-protected' },
				{ label: 'Persistent vandalism (semi)', selected: true, value: 'pp-semi-vandalism' },
				{ label: 'Disruptive editing (semi)', value: 'pp-semi-disruptive' },
				{ label: 'Adding unsourced content (semi)', value: 'pp-semi-unsourced' },
				{ label: 'BLP policy violations (semi)', value: 'pp-semi-blp' },
				{ label: 'Sockpuppetry (semi)', value: 'pp-semi-sock' },
				{ label: 'User talk of blocked user (semi)', value: 'pp-semi-usertalk' },
			],
		},
		{
			label: 'Pending changes',
			list: [
				{ label: 'Generic (PC)', value: 'pp-pc-protected' },
				{ label: 'Persistent vandalism (PC)', value: 'pp-pc-vandalism' },
				{ label: 'Disruptive editing (PC)', value: 'pp-pc-disruptive' },
				{ label: 'Adding unsourced content (PC)', value: 'pp-pc-unsourced' },
				{ label: 'BLP policy violations (PC)', value: 'pp-pc-blp' },
			],
		},
		{
			label: 'Move protection',
			list: [
				{ label: 'Generic (move)', value: 'pp-move' },
				{ label: 'Dispute/move warring (move)', value: 'pp-move-dispute' },
				{ label: 'Page-move vandalism (move)', value: 'pp-move-vandalism' },
				{ label: 'Highly visible page (move)', value: 'pp-move-indef' },
			],
		},
	].filter((type) => {
		// Filter for templates and flaggedrevs
		return (
			(this.isTemplate || type.label !== 'Template protection') &&
			(this.hasFlaggedRevs || type.label !== 'Pending changes')
		);
	});

	protectionTypesCreate = [
		{ label: 'Unprotection', value: 'unprotect' },
		{
			label: 'Create protection',
			list: [
				{ label: 'Generic ({{pp-create}})', value: 'pp-create' },
				{ label: 'Offensive name', value: 'pp-create-offensive' },
				{ label: 'Repeatedly recreated', selected: true, value: 'pp-create-salt' },
				{ label: 'Recently deleted BLP', value: 'pp-create-blp' },
			],
		},
	];

	// A page with both regular and PC protection will be assigned its regular
	// protection weight plus 2
	protectionWeight = {
		sysop: 40,
		templateeditor: 30,
		extendedconfirmed: 20,
		autoconfirmed: 10,
		flaggedrevs_autoconfirmed: 5, // Pending Changes protection alone
		all: 0,
		flaggedrevs_none: 0, // just in case
	};

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
			if (mw.config.get('wgArticleId') && mw.config.get('wgPageContentModel') !== 'Scribunto') {
				if (form.category.value === 'unprotect') {
					form.tagtype.value = 'none';
				} else {
					form.tagtype.value = item.template ? item.template : form.category.value;
				}
				this.formevents.tagtype({ target: form.tagtype });

				// We only have one TE template at the moment, so this
				// should be expanded if more are added (e.g. pp-semi-template)
				if (form.category.value === 'pp-template') {
					form.noinclude.checked = true;
				} else if (mw.config.get('wgNamespaceNumber') !== 10) {
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
		if (
			input.actiontype === 'tag' ||
			(input.actiontype === 'protect' &&
				mw.config.get('wgArticleId') &&
				mw.config.get('wgPageContentModel') !== 'Scribunto')
		) {
			tagparams = {
				tag: input.tagtype,
				reason:
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

				var allDone = function twinkleprotectCallbackAllDone() {
					if (thispage) {
						thispage.getStatusElement().info('done');
					}
					if (tagparams) {
						this.taggingPageInitial(tagparams);
					}
				};

				var protectIt = function twinkleprotectCallbackProtectIt(next) {
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

				var stabilizeIt = function twinkleprotectCallbackStabilizeIt() {
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

				this.taggingPageInitial(tagparams);
				break;

			case 'request':
				// file request at RFPP
				var typename, typereason;
				switch (input.category) {
					case 'pp-dispute':
					case 'pp-vandalism':
					case 'pp-usertalk':
					case 'pp-protected':
						typename = 'full protection';
						break;
					case 'pp-template':
						typename = 'template protection';
						break;
					case 'pp-30-500-arb':
					case 'pp-30-500-vandalism':
					case 'pp-30-500-disruptive':
					case 'pp-30-500-blp':
					case 'pp-30-500-sock':
						typename = 'extended confirmed protection';
						break;
					case 'pp-semi-vandalism':
					case 'pp-semi-disruptive':
					case 'pp-semi-unsourced':
					case 'pp-semi-usertalk':
					case 'pp-semi-sock':
					case 'pp-semi-blp':
					case 'pp-semi-protected':
						typename = 'semi-protection';
						break;
					case 'pp-pc-vandalism':
					case 'pp-pc-blp':
					case 'pp-pc-protected':
					case 'pp-pc-unsourced':
					case 'pp-pc-disruptive':
						typename = 'pending changes';
						break;
					case 'pp-move':
					case 'pp-move-dispute':
					case 'pp-move-indef':
					case 'pp-move-vandalism':
						typename = 'move protection';
						break;
					case 'pp-create':
					case 'pp-create-offensive':
					case 'pp-create-blp':
					case 'pp-create-salt':
						typename = 'create protection';
						break;
					case 'unprotect':
						var admins = $.map(this.currentProtectionLevels, (pl) => {
							if (!pl.admin || this.trustedBots.indexOf(pl.admin) !== -1) {
								return null;
							}
							return 'User:' + pl.admin;
						});
						if (
							admins.length &&
							!confirm(
								'Have you attempted to contact the protecting admins (' +
									Morebits.array.uniq(admins).join(', ') +
									') first?'
							)
						) {
							return false;
						}
					// otherwise falls through
					default:
						typename = 'unprotection';
						break;
				}
				switch (input.category) {
					case 'pp-dispute':
						typereason = 'Content dispute/edit warring';
						break;
					case 'pp-vandalism':
					case 'pp-semi-vandalism':
					case 'pp-pc-vandalism':
					case 'pp-30-500-vandalism':
						typereason = 'Persistent [[WP:VAND|vandalism]]';
						break;
					case 'pp-semi-disruptive':
					case 'pp-pc-disruptive':
					case 'pp-30-500-disruptive':
						typereason = 'Persistent [[Wikipedia:Disruptive editing|disruptive editing]]';
						break;
					case 'pp-semi-unsourced':
					case 'pp-pc-unsourced':
						typereason = 'Persistent addition of [[WP:INTREF|unsourced or poorly sourced content]]';
						break;
					case 'pp-template':
						typereason = '[[WP:HIGHRISK|High-risk template]]';
						break;
					case 'pp-30-500-arb':
						typereason = '[[WP:30/500|Arbitration enforcement]]';
						break;
					case 'pp-usertalk':
					case 'pp-semi-usertalk':
						typereason = 'Inappropriate use of user talk page while blocked';
						break;
					case 'pp-semi-sock':
					case 'pp-30-500-sock':
						typereason = 'Persistent [[WP:SOCK|sockpuppetry]]';
						break;
					case 'pp-semi-blp':
					case 'pp-pc-blp':
					case 'pp-30-500-blp':
						typereason = '[[WP:BLP|BLP]] policy violations';
						break;
					case 'pp-move-dispute':
						typereason = 'Page title dispute/move warring';
						break;
					case 'pp-move-vandalism':
						typereason = 'Page-move vandalism';
						break;
					case 'pp-move-indef':
						typereason = 'Highly visible page';
						break;
					case 'pp-create-offensive':
						typereason = 'Offensive name';
						break;
					case 'pp-create-blp':
						typereason = 'Recently deleted [[WP:BLP|BLP]]';
						break;
					case 'pp-create-salt':
						typereason = 'Repeatedly recreated';
						break;
					default:
						typereason = '';
						break;
				}

				var reason = typereason;
				if (input.reason !== '') {
					if (typereason !== '') {
						reason += '\u00A0\u2013 '; // U+00A0 NO-BREAK SPACE; U+2013 EN RULE
					}
					reason += input.reason;
				}
				if (reason !== '' && reason.charAt(reason.length - 1) !== '.') {
					reason += '.';
				}

				var rppparams = {
					reason: reason,
					typename: typename,
					category: input.category,
					expiry: input.expiry,
				};

				Morebits.simpleWindow.setButtonsEnabled(false);
				Morebits.status.init(form);

				var rppName = 'Wikipedia:Requests for page protection';

				// Updating data for the action completed event
				Morebits.wiki.actionCompleted.redirect = rppName;
				Morebits.wiki.actionCompleted.notice = 'Nomination completed, redirecting now to the discussion page';

				var rppPage = new Morebits.wiki.page(rppName, 'Requesting protection of page');
				rppPage.setFollowRedirect(true);
				rppPage.setCallbackParameters(rppparams);
				rppPage.load(this.fileRequest);
				break;
			default:
				alert('twinkleprotect: unknown kind of action');
				break;
		}
	}

	protectReasonAnnotations = [];

	annotateProtectReason(e) {
		var form = e.target.form;
		var checkbox = e.target;
		var protectReason = form.protectReason.value.replace(
			new RegExp('(?:; )?' + mw.util.escapeRegExp(this.protectReasonAnnotations.join(': '))),
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
			this.protectReasonAnnotations = this.protectReasonAnnotations.filter((el) => {
				return el.indexOf('[[Special:Permalink') === -1;
			});
			if (e.target.value.length) {
				var permalink = '[[Special:Permalink/' + e.target.value + '#' + Morebits.pageNameNorm + ']]';
				this.protectReasonAnnotations.push(permalink);
			}
		}

		if (!this.protectReasonAnnotations.length) {
			form.protectReason.value = protectReason;
		} else {
			form.protectReason.value = (protectReason ? protectReason + '; ' : '') + this.protectReasonAnnotations.join(': ');
		}
	}

	taggingPageInitial(tagparams) {
		if (tagparams.tag === 'noop') {
			Morebits.status.info('Applying protection template', 'nothing to do');
			return;
		}

		var protectedPage = new Morebits.wiki.page(mw.config.get('wgPageName'), 'Tagging page');
		protectedPage.setCallbackParameters(tagparams);
		protectedPage.load(this.taggingPage);
	}

	taggingPage(protectedPage) {
		var params = protectedPage.getCallbackParameters();
		var text = protectedPage.getPageText();
		var tag, summary;

		var oldtag_re = /\s*(?:<noinclude>)?\s*\{\{\s*(pp-[^{}]*?|protected|(?:t|v|s|p-|usertalk-v|usertalk-s|sb|move)protected(?:2)?|protected template|privacy protection)\s*?\}\}\s*(?:<\/noinclude>)?\s*/gi;
		var re_result = oldtag_re.exec(text);
		if (re_result) {
			if (
				params.tag === 'none' ||
				confirm(
					'{{' + re_result[1] + '}} was found on the page. \nClick OK to remove it, or click Cancel to leave it there.'
				)
			) {
				text = text.replace(oldtag_re, '');
			}
		}

		if (params.tag === 'none') {
			summary = 'Removing protection template';
		} else {
			tag = params.tag;
			if (params.reason) {
				tag += '|reason=' + params.reason;
			}
			if (params.small) {
				tag += '|small=yes';
			}

			if (/^\s*#redirect/i.test(text)) {
				// redirect page
				// Only tag if no {{rcat shell}} is found
				if (!text.match(/{{(?:redr|this is a redirect|r(?:edirect)?(?:.?cat.*)?[ _]?sh)/i)) {
					text = text.replace(/#REDIRECT ?(\[\[.*?\]\])(.*)/i, '#REDIRECT $1$2\n\n{{' + tag + '}}');
				} else {
					Morebits.status.info('Redirect category shell present', 'nothing to do');
					return;
				}
			} else {
				if (params.noinclude) {
					tag = '<noinclude>{{' + tag + '}}</noinclude>';
				} else {
					tag = '{{' + tag + '}}\n';
				}

				// Insert tag after short description or any hatnotes
				var wikipage = new Morebits.wikitext.page(text);
				text = wikipage.insertAfterTemplates(tag, hatnoteRegex).getText();
			}
			summary = 'Adding {{' + params.tag + '}}';
		}

		protectedPage.setEditSummary(summary);
		protectedPage.setChangeTags(Twinkle.changeTags);
		protectedPage.setWatchlist(getPref('watchPPTaggedPages'));
		protectedPage.setPageText(text);
		protectedPage.setCreateOption('nocreate');
		protectedPage.suppressProtectWarning(); // no need to let admins know they are editing through protection
		protectedPage.save();
	}

	fileRequest(rppPage) {
		var params = rppPage.getCallbackParameters();
		var text = rppPage.getPageText();
		var statusElement = rppPage.getStatusElement();

		var rppRe = new RegExp(
			'===\\s*(\\[\\[)?\\s*:?\\s*' + Morebits.string.escapeRegExp(Morebits.pageNameNorm) + '\\s*(\\]\\])?\\s*===',
			'm'
		);
		var tag = rppRe.exec(text);

		var rppLink = document.createElement('a');
		rppLink.setAttribute('href', mw.util.getUrl(rppPage.getPageName()));
		rppLink.appendChild(document.createTextNode(rppPage.getPageName()));

		if (tag) {
			statusElement.error(['There is already a protection request for this page at ', rppLink, ', aborting.']);
			return;
		}

		var newtag = '=== [[:' + Morebits.pageNameNorm + ']] ===\n';
		if (new RegExp('^' + mw.util.escapeRegExp(newtag).replace(/\s+/g, '\\s*'), 'm').test(text)) {
			statusElement.error(['There is already a protection request for this page at ', rppLink, ', aborting.']);
			return;
		}
		newtag += '* {{pagelinks|1=' + Morebits.pageNameNorm + '}}\n\n';

		var words;
		switch (params.expiry) {
			case 'temporary':
				words = 'Temporary ';
				break;
			case 'infinity':
				words = 'Indefinite ';
				break;
			default:
				words = '';
				break;
		}

		words += params.typename;

		newtag +=
			"'''" +
			Morebits.string.toUpperCaseFirstChar(words) +
			(params.reason !== '' ? ":''' " + Morebits.string.formatReasonText(params.reason) : ".'''") +
			' ~~~~';

		// If either protection type results in a increased status, then post it under increase
		// else we post it under decrease
		var increase = false;
		var protInfo = this.protectionPresetsInfo[params.category];

		// function to compute protection weights (see comment at this.protectionWeight)
		var computeWeight = (mainLevel, stabilizeLevel?) => {
			var result = this.protectionWeight[mainLevel || 'all'];
			if (stabilizeLevel) {
				if (result) {
					if (stabilizeLevel.level === 'autoconfirmed') {
						result += 2;
					}
				} else {
					result = this.protectionWeight['flaggedrevs_' + stabilizeLevel];
				}
			}
			return result;
		};

		// compare the page's current protection weights with the protection we are requesting
		var editWeight = computeWeight(
			this.currentProtectionLevels.edit && this.currentProtectionLevels.edit.level,
			this.currentProtectionLevels.stabilize && this.currentProtectionLevels.stabilize.level
		);
		if (
			computeWeight(protInfo.edit, protInfo.stabilize) > editWeight ||
			computeWeight(protInfo.move) >
				computeWeight(this.currentProtectionLevels.move && this.currentProtectionLevels.move.level) ||
			computeWeight(protInfo.create) >
				computeWeight(this.currentProtectionLevels.create && this.currentProtectionLevels.create.level)
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
		text = text.replace(reg, '\n' + newtag + '\n$1');
		if (text.length === originalTextLength) {
			var linknode = document.createElement('a');
			linknode.setAttribute('href', mw.util.getUrl('Wikipedia:Twinkle/Fixing RPP'));
			linknode.appendChild(document.createTextNode('How to fix RPP'));
			statusElement.error([
				'Could not find relevant heading on WP:RPP. To fix this problem, please see ',
				linknode,
				'.',
			]);
			return;
		}
		statusElement.status('Adding new request...');
		rppPage.setEditSummary(
			'/* ' +
				Morebits.pageNameNorm +
				' */ Requesting ' +
				params.typename +
				(params.typename === 'pending changes' ? ' on [[:' : ' of [[:') +
				Morebits.pageNameNorm +
				']].'
		);
		rppPage.setChangeTags(Twinkle.changeTags);
		rppPage.setPageText(text);
		rppPage.setCreateOption('recreate');
		rppPage.save(() => {
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
				new Morebits.wiki.api('Adding requested page to watchlist', watch_query).post();
			}
		});
	}
}