import { Dialog } from '../Dialog';
import { LogEvent } from '../utils';
import { TwinkleModule } from '../twinkleModule';
import { addPortletLink } from '../portlet';

export class ProtectCore extends TwinkleModule {
	constructor() {
		super();
		if (mw.config.get('wgNamespaceNumber') < 0 || mw.config.get('wgNamespaceNumber') === 8) {
			return;
		}
		addPortletLink(
			this.makeWindow.bind(this),
			Morebits.userIsSysop ? 'PP' : 'RPP',
			'tw-rpp',
			Morebits.userIsSysop ? 'Protect page' : 'Request page protection'
		);
	}

	makeWindow() {
		var Window = new Dialog(620, 530);
		Window.setTitle(Morebits.userIsSysop ? 'Apply, request or tag page protection' : 'Request or tag page protection');
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
							return $.inArray(le.logid, logIds); // XXX ???
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
			cascade: boolean;
			admin: string;
		}
	> = {};

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
			var current = {},
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
					// logs report last admin who made changes to either edit/move/create protection, regardless if they only modified one of them
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
	protectLog: LogEvent[];
	hasStableLog: boolean;
	stableLog: LogEvent[];

	changeAction(e) {}

	evaluate(e) {}

	showLogAndCurrentProtectInfo() {}
}
