import { Twinkle } from '../twinkle';
import { Dialog } from '../Dialog';
import { LogEvent } from '../utils';
import { msg } from '../messenger';
import { TwinkleModule } from '../twinkleModule';
import { getPref } from '../Config';

export type BlockPresetInfo = {
	expiry?: string;
	forRegisteredOnly?: boolean;
	forAnonOnly?: boolean;
	nocreate?: boolean;
	nonstandard?: boolean;
	disabletalk?: boolean;
	noemail?: boolean;
	reason?: string;
	sig?: string | null;
	templateName?: string;
	pageParam?: boolean;
	reasonParam?: boolean;
	prependReason?: boolean;
	summary?: string;
	suppressArticleInSummary?: boolean;
	autoblock?: boolean;
	hardblock?: boolean;
	useInitialOptions?: boolean;
};

var menuFormattedNamespaces = $.extend({}, mw.config.get('wgFormattedNamespaces'));
menuFormattedNamespaces[0] = msg('blanknamespace');

export class BlockCore extends TwinkleModule {
	moduleName = 'block';
	static moduleName = 'block';

	relevantUserName: string;
	blockedUserName: string;

	portletId = 'twinkle-block';
	portletName = 'Block';
	portletTooltip = 'Block relevant user';

	blockPresetsInfo: Record<string, BlockPresetInfo>;
	blockGroups: quickFormElementData[];
	blockGroupsPartial: quickFormElementData[];
	dsinfo: Record<string, { code: string; page?: string }>;

	constructor() {
		super();
		this.relevantUserName = mw.config.get('wgRelevantUserName');
		// should show on Contributions or Block pages, anywhere there's a relevant user
		// Ignore ranges wider than the CIDR limit
		if (
			Morebits.userIsSysop &&
			this.relevantUserName &&
			(!Morebits.ip.isRange(this.relevantUserName) || Morebits.ip.validCIDR(this.relevantUserName))
		) {
			this.addMenu();
		}
	}

	makeWindow() {
		if (
			this.relevantUserName === mw.config.get('wgUserName') &&
			!confirm('You are about to block yourself! Are you sure you want to proceed?')
		) {
			return;
		}

		this.currentBlockInfo = undefined;
		this.field_block_options = {};
		this.field_template_options = {};

		var Window = new Dialog(650, 530);
		// need to be verbose about who we're blocking
		Window.setTitle('Block or issue block template to ' + this.relevantUserName);
		Window.setFooterLinks(this.footerlinks);

		// Always added, hidden later if actual user not blocked
		Window.addFooterLink('Unblock this user', 'Special:Unblock/' + this.relevantUserName, true);

		var form = new Morebits.quickForm((e) => this.evaluate(e));
		var actionfield = form.append({
			type: 'field',
			label: 'Type of action',
		});
		actionfield.append({
			type: 'checkbox',
			name: 'actiontype',
			event: this.change_action.bind(this),
			list: [
				{
					label: 'Block user',
					value: 'block',
					tooltip:
						'Block the relevant user with the given options. If partial block is unchecked, this will be a sitewide block.',
					checked: true,
				},
				{
					label: 'Partial block',
					value: 'partial',
					tooltip: 'Enable partial blocks and partial block templates.',
					checked: getPref('defaultToPartialBlocks'), // Overridden if already blocked
				},
				{
					label: 'Add block template to user talk page',
					value: 'template',
					tooltip:
						'If the blocking admin forgot to issue a block template, or you have just blocked the user without templating them, you can use this to issue the appropriate template. Check the partial block box for partial block templates.',
					// Disallow when viewing the block dialog on an IP range
					checked: !Morebits.ip.isRange(this.relevantUserName),
					disabled: Morebits.ip.isRange(this.relevantUserName),
				},
			],
		});

		/*
		  Add option for IPv6 ranges smaller than /64 to upgrade to the 64
		  CIDR ([[WP:/64]]).  This is one of the few places where we want
		  wgRelevantUserName since this depends entirely on the original user.
		  In theory, we shouldn't use Morebits.ip.get64 here since since we want
		  to exclude functionally-equivalent /64s.  That'd be:
		  // if (mw.util.isIPv6Address(mw.config.get('wgRelevantUserName'), true) &&
		  // (mw.util.isIPv6Address(mw.config.get('wgRelevantUserName')) || parseInt(mw.config.get('wgRelevantUserName').replace(/^(.+?)\/?(\d{1,3})?$/, '$2'), 10) > 64)) {
		  In practice, though, since functionally-equivalent ranges are
		  (mis)treated as separate by MediaWiki's logging ([[phab:T146628]]),
		  using Morebits.ip.get64 provides a modicum of relief in this case.
		*/
		var sixtyFour = Morebits.ip.get64(mw.config.get('wgRelevantUserName'));
		if (sixtyFour && sixtyFour !== mw.config.get('wgRelevantUserName')) {
			var block64field = form.append({
				type: 'field',
				label: 'Convert to /64 rangeblock',
				name: 'field_64',
			});
			block64field.append({
				type: 'div',
				style: 'margin-bottom: 0.5em',
				label: [
					"It's usually fine, if not better, to ",
					$.parseHTML(
						'<a target="_blank" href="' + mw.util.getUrl('WP:/64') + '">just block the /64</a>'
					)[0] as HTMLElement,
					' range (',
					$.parseHTML(
						'<a target="_blank" href="' +
							mw.util.getUrl('Special:Contributions/' + sixtyFour) +
							'">' +
							sixtyFour +
							'</a>)'
					)[0] as HTMLElement,
					').',
				],
			});
			block64field.append({
				type: 'checkbox',
				name: 'block64',
				event: this.change_block64.bind(this),
				list: [
					{
						checked: this.relevantUserName !== mw.config.get('wgRelevantUserName'), // In case the user closes and reopens the form
						label: 'Block the /64 instead',
						value: 'block64',
						tooltip: Morebits.ip.isRange(mw.config.get('wgRelevantUserName'))
							? 'Will eschew leaving a template.'
							: 'Any template issued will go to the original IP: ' + mw.config.get('wgRelevantUserName'),
					},
				],
			});
		}

		form.append({ type: 'field', label: 'Preset', name: 'field_preset' });
		form.append({ type: 'field', label: 'Template options', name: 'field_template_options' });
		form.append({ type: 'field', label: 'Block options', name: 'field_block_options' });

		form.append({ type: 'submit' });

		var result = form.render();
		Window.setContent(result);
		Window.display();
		result.root = result;

		new Morebits.wiki.user(this.relevantUserName, 'Fetching user information').load(
			(userobj) => {
				this.processUserInfo(userobj, () => {
					// Toggle initial partial state depending on prior block type,
					// will override the defaultToPartialBlocks pref
					if (this.blockedUserName === this.relevantUserName) {
						$(result).find('[name=actiontype][value=partial]').prop('checked', this.currentBlockInfo.partial);
					}

					// clean up preset data (defaults, etc.), done exactly once, must be before this.change_action is called
					this.transformBlockPresets();

					// init the controls after user and block info have been fetched
					var evt = document.createEvent('Event');
					evt.initEvent('change', true, true);
					result.actiontype[0].dispatchEvent(evt);
				});
			},
			function () {
				Morebits.status.init($('div[name="currentblock"] span').last()[0]);
				Morebits.status.warn('Error fetching user info');
			}
		);
	}

	isRegistered: boolean;
	userIsBot: boolean;
	hasBlockLog: boolean;
	lastBlockLogEntry: LogEvent;
	lastBlockLogId: number | false;

	fetchedData = {};
	currentBlockInfo: any;

	processUserInfo(userobj: Morebits.wiki.user, fn: Function) {
		var blockinfo = userobj.getBlockInfo();
		// Cache response, used when toggling /64 blocks
		this.fetchedData[userobj.getUserName()] = userobj;

		this.isRegistered = !userobj.isIP();
		this.userIsBot = userobj.isBot();

		if (blockinfo) {
			// handle frustrating system of inverted boolean values
			blockinfo.disabletalk = !blockinfo.allowusertalk;
			blockinfo.hardblock = !blockinfo.anononly;
		}
		// will undefine if no blocks present
		this.currentBlockInfo = blockinfo;
		this.blockedUserName = this.currentBlockInfo && this.currentBlockInfo.user;

		// Toggle unblock link if not the user in question; always first
		var unblockLink = document.querySelector('.morebits-dialog-footerlinks a');
		if (this.blockedUserName !== this.relevantUserName) {
			unblockLink.hidden = true;
			unblockLink.nextSibling.hidden = true; // link+trailing bullet
		} else {
			unblockLink.hidden = false;
			unblockLink.nextSibling.hidden = false; // link+trailing bullet
		}

		// Semi-busted on ranges, see [[phab:T270737]] and [[phab:T146628]].
		// Basically, logevents doesn't treat functionally-equivalent ranges
		// as equivalent, meaning any functionally-equivalent IP range is
		// misinterpreted by the log throughout.  Without logevents
		// redirecting (like Special:Block does) we would need a function to
		// parse ranges, which is a pain.  IPUtils has the code, but it'd be a
		// lot of cruft for one purpose.
		this.hasBlockLog = userobj.hasBlockLog();
		this.lastBlockLogEntry = userobj.getLastBlockLogEntry();
		// Used later to check if block status changed while filling out the form
		this.lastBlockLogId = this.hasBlockLog ? this.lastBlockLogEntry.logid : false;

		if (typeof fn === 'function') {
			return fn();
		}
	}

	saveFieldset(fieldset: HTMLFieldSetElement | JQuery) {
		this[$(fieldset).prop('name')] = {};
		$(fieldset)
			.serializeArray()
			.forEach((el) => {
				// namespaces and pages for partial blocks are overwritten
				// here, but we're handling them elsewhere so that's fine
				this[$(fieldset).prop('name')][el.name] = el.value;
			});
	}

	change_block64(e) {
		var $form = $(e.target.form),
			$block64 = $form.find('[name=block64]');

		// Show/hide block64 button
		// Single IPv6, or IPv6 range smaller than a /64
		var priorName = this.relevantUserName;
		if ($block64.is(':checked')) {
			this.relevantUserName = Morebits.ip.get64(mw.config.get('wgRelevantUserName')) as string;
		} else {
			this.relevantUserName = mw.config.get('wgRelevantUserName');
		}
		// No templates for ranges, but if the original user is a single IP, offer the option
		// (done separately in this.issue_template)
		var originalIsRange = Morebits.ip.isRange(mw.config.get('wgRelevantUserName'));
		$form.find('[name=actiontype][value=template]').prop('disabled', originalIsRange).prop('checked', !originalIsRange);

		// Refetch/reprocess user info then regenerate the main content
		var regenerateForm = () => {
			// Tweak titlebar text.  In theory, we could save the dialog
			// at initialization and then use `.setTitle` or
			// `dialog('option', 'title')`, but in practice that swallows
			// the scriptName and requires `.display`ing, which jumps the
			// window.  It's just a line of text, so this is fine.
			var titleBar = document.querySelector('.ui-dialog-title').firstChild.nextSibling;
			titleBar.nodeValue = titleBar.nodeValue.replace(priorName, this.relevantUserName);
			// Tweak unblock link
			var unblockLink = document.querySelector('.morebits-dialog-footerlinks a') as HTMLAnchorElement;
			unblockLink.href = unblockLink.href.replace(priorName, this.relevantUserName);
			unblockLink.title = unblockLink.title.replace(priorName, this.relevantUserName);

			// Correct partial state
			$form.find('[name=actiontype][value=partial]').prop('checked', getPref('defaultToPartialBlocks'));
			if (this.blockedUserName === this.relevantUserName) {
				$form.find('[name=actiontype][value=partial]').prop('checked', this.currentBlockInfo.partial);
			}

			// Set content appropriately
			this.change_action(e);
		};

		if (this.fetchedData[this.relevantUserName]) {
			this.processUserInfo(this.fetchedData[this.relevantUserName], regenerateForm);
		} else {
			new Morebits.wiki.user(this.relevantUserName, 'Fetching user information').load(
				(userobj) => {
					this.processUserInfo(userobj, regenerateForm);
				},
				function () {
					Morebits.status.init($('div[name="currentblock"] span').last()[0]);
					Morebits.status.warn('Error fetching user info');
				}
			);
		}
	}

	change_action(e) {
		var field_preset,
			field_template_options,
			field_block_options,
			$form = $(e.target.form);
		// Make ifs shorter
		var blockBox = $form.find('[name=actiontype][value=block]').is(':checked');
		var templateBox = $form.find('[name=actiontype][value=template]').is(':checked');
		var $partial = $form.find('[name=actiontype][value=partial]');
		var partialBox = $partial.is(':checked');
		var blockGroup = partialBox ? this.blockGroupsPartial : this.blockGroups;

		$partial.prop('disabled', !blockBox && !templateBox);

		// Add current block parameters as default preset
		var prior = { label: 'Prior block' };
		if (this.blockedUserName === this.relevantUserName) {
			this.blockPresetsInfo.prior = this.currentBlockInfo;
			// value not a valid template selection, chosen below by setting templateName
			prior.list = [{ label: 'Prior block settings', value: 'prior', selected: true }];

			// Arrays of objects are annoying to check
			if (!blockGroup.some((bg) => bg.label === prior.label)) {
				blockGroup.push(prior);
			}

			// Always ensure proper template exists/is selected when switching modes
			if (partialBox) {
				this.blockPresetsInfo.prior.templateName = Morebits.string.isInfinity(this.currentBlockInfo.expiry)
					? 'uw-pblockindef'
					: 'uw-pblock';
			} else {
				if (!this.isRegistered) {
					this.blockPresetsInfo.prior.templateName = 'uw-ablock';
				} else {
					this.blockPresetsInfo.prior.templateName = Morebits.string.isInfinity(this.currentBlockInfo.expiry)
						? 'uw-blockindef'
						: 'uw-block';
				}
			}
		} else {
			// But first remove any prior prior
			blockGroup = blockGroup.filter((bg) => bg.label !== prior.label);
		}

		// Can be in preset or template field, so the old one in the template
		// field will linger. No need to keep the old value around, so just
		// remove it; saves trouble when hiding/evaluating
		$form.find('[name=dstopic]').parent().remove();

		this.saveFieldset($('[name=field_block_options]'));
		this.saveFieldset($('[name=field_template_options]'));

		if (blockBox) {
			field_preset = new Morebits.quickForm.element({ type: 'field', label: 'Preset', name: 'field_preset' });
			field_preset.append({
				type: 'select',
				name: 'preset',
				label: 'Choose a preset:',
				event: this.change_preset.bind(this),
				list: this.filtered_block_groups(blockGroup),
			});

			field_block_options = new Morebits.quickForm.element({
				type: 'field',
				label: 'Block options',
				name: 'field_block_options',
			});
			field_block_options.append({ type: 'div', name: 'currentblock', label: ' ' });
			field_block_options.append({ type: 'div', name: 'hasblocklog', label: ' ' });
			field_block_options.append({
				type: 'select',
				name: 'expiry_preset',
				label: msg('block-expiration'),
				event: this.change_expiry.bind(this),
				list: [
					{ label: 'custom', value: 'custom', selected: true },
					{ label: 'indefinite', value: 'infinity' },
					{ label: msg('duration-hours', 3), value: '3 hours' },
					{ label: msg('duration-hours', 12), value: '12 hours' },
					{ label: msg('duration-hours', 24), value: '24 hours' },
					{ label: msg('duration-hours', 31), value: '31 hours' },
					{ label: msg('duration-hours', 36), value: '36 hours' },
					{ label: msg('duration-hours', 48), value: '48 hours' },
					{ label: msg('duration-hours', 60), value: '60 hours' },
					{ label: msg('duration-hours', 72), value: '72 hours' },
					{ label: msg('duration-weeks', 1), value: '1 week' },
					{ label: msg('duration-weeks', 2), value: '2 weeks' },
					{ label: msg('duration-months', 1), value: '1 month' },
					{ label: msg('duration-months', 3), value: '3 months' },
					{ label: msg('duration-months', 6), value: '6 months' },
					{ label: msg('duration-years', 1), value: '1 year' },
					{ label: msg('duration-years', 2), value: '2 years' },
					{ label: msg('duration-years', 3), value: '3 years' },
				],
			});
			field_block_options.append({
				type: 'input',
				name: 'expiry',
				label: 'Custom expiry',
				tooltip:
					'You can use relative times, like "1 minute" or "19 days", or absolute timestamps, "yyyymmddhhmm" (e.g. "200602011405" is Feb 1, 2006, at 14:05 UTC).',
				value: this.field_block_options.expiry || this.field_template_options.template_expiry,
			});

			if (partialBox) {
				// Partial block
				field_block_options.append({
					type: 'select',
					multiple: true,
					name: 'pagerestrictions',
					label: 'Specific pages to block from editing',
					value: '',
					tooltip: '10 page max.',
				});
				var ns = field_block_options.append({
					type: 'select',
					multiple: true,
					name: 'namespacerestrictions',
					label: 'Namespace blocks',
					value: '',
					tooltip: 'Block from editing these namespaces.',
				});
				$.each(menuFormattedNamespaces, function (number, name) {
					// Ignore -1: Special; -2: Media; and 2300-2303: Gadget (talk) and Gadget definition (talk)
					if (number >= 0 && number < 830) {
						ns.append({ type: 'option', label: name, value: number });
					}
				});
			}

			var blockoptions = [
				{
					checked: this.field_block_options.nocreate,
					label: 'Block account creation',
					name: 'nocreate',
					value: '1',
				},
				{
					checked: this.field_block_options.noemail,
					label: 'Block user from sending email',
					name: 'noemail',
					value: '1',
				},
				{
					checked: this.field_block_options.disabletalk,
					label: 'Prevent this user from editing their own talk page while blocked',
					name: 'disabletalk',
					value: '1',
					tooltip: partialBox
						? 'If issuing a partial block, this MUST remain unchecked unless you are also preventing them from editing User talk space'
						: '',
				},
			];

			if (this.isRegistered) {
				blockoptions.push({
					checked: this.field_block_options.autoblock,
					label: 'Autoblock any IP addresses used (hardblock)',
					name: 'autoblock',
					value: '1',
				});
			} else {
				blockoptions.push({
					checked: this.field_block_options.hardblock,
					label: 'Block logged-in users from using this IP address (hardblock)',
					name: 'hardblock',
					value: '1',
				});
			}

			blockoptions.push({
				checked: this.field_block_options.watchuser,
				label: 'Watch user and user talk pages',
				name: 'watchuser',
				value: '1',
			});

			field_block_options.append({
				type: 'checkbox',
				name: 'blockoptions',
				list: blockoptions,
			});
			field_block_options.append({
				type: 'textarea',
				label: 'Reason (for block log):',
				name: 'reason',
				tooltip: 'Consider adding helpful details to the default message.',
				value: this.field_block_options.reason,
			});

			field_block_options.append({
				type: 'div',
				name: 'filerlog_label',
				label: 'See also:',
				style: 'display:inline-block;font-style:normal !important',
				tooltip:
					'Insert a "see also" message to indicate whether the filter log or deleted contributions played a role in the decision to block.',
			});
			field_block_options.append({
				type: 'checkbox',
				name: 'filter_see_also',
				event: this.toggle_see_alsos.bind(this),
				style: 'display:inline-block; margin-right:5px',
				list: [
					{
						label: 'Filter log',
						checked: false,
						value: 'filter log',
					},
				],
			});
			field_block_options.append({
				type: 'checkbox',
				name: 'deleted_see_also',
				event: this.toggle_see_alsos.bind(this),
				style: 'display:inline-block',
				list: [
					{
						label: 'Deleted contribs',
						checked: false,
						value: 'deleted contribs',
					},
				],
			});

			// Yet-another-logevents-doesn't-handle-ranges-well
			if (this.blockedUserName === this.relevantUserName) {
				field_block_options.append({ type: 'hidden', name: 'reblock', value: '1' });
			}
		}

		// DS selection visible in either the template field set or preset,
		// joint settings saved here
		var dsSelectSettings = {
			type: 'select',
			name: 'dstopic',
			label: 'DS topic',
			value: '',
			tooltip: 'If selected, it will inform the template and may be added to the blocking message',
			event: this.toggle_ds_reason,
			list: $.map(this.dsinfo, function (info, label) {
				return { label: label, value: info.code };
			}),
		};
		if (templateBox) {
			field_template_options = new Morebits.quickForm.element({
				type: 'field',
				label: 'Template options',
				name: 'field_template_options',
			});
			field_template_options.append({
				type: 'select',
				name: 'template',
				label: 'Choose talk page template:',
				event: this.change_template.bind(this),
				list: this.filtered_block_groups(blockGroup, true),
				value: this.field_template_options.template,
			});

			// Only visible for aeblock and aepblock, toggled in change_template
			field_template_options.append(dsSelectSettings);

			field_template_options.append({
				type: 'input',
				name: 'article',
				label: 'Linked page',
				value: '',
				tooltip:
					'A page can be linked within the notice, perhaps if it was the primary target of disruption. Leave empty for no page to be linked.',
			});

			// Only visible if partial and not blocking
			field_template_options.append({
				type: 'input',
				name: 'area',
				label: 'Area blocked from',
				value: '',
				tooltip: 'Optional explanation of the pages or namespaces the user was blocked from editing.',
			});

			if (!blockBox) {
				field_template_options.append({
					type: 'input',
					name: 'template_expiry',
					label: 'Period of blocking: ',
					value: '',
					tooltip: 'The period the blocking is due for, for example 24 hours, 2 weeks, indefinite etc...',
				});
			}
			field_template_options.append({
				type: 'input',
				name: 'block_reason',
				label: '"You have been blocked for ..." ',
				tooltip:
					'An optional reason, to replace the default generic reason. Only available for the generic block templates.',
				value: this.field_template_options.block_reason,
			});

			if (blockBox) {
				field_template_options.append({
					type: 'checkbox',
					name: 'blank_duration',
					list: [
						{
							label: 'Do not include expiry in template',
							checked: this.field_template_options.blank_duration,
							tooltip:
								'Instead of including the duration, make the block template read "You have been blocked temporarily..."',
						},
					],
				});
			} else {
				field_template_options.append({
					type: 'checkbox',
					list: [
						{
							label: 'Talk page access disabled',
							name: 'notalk',
							checked: this.field_template_options.notalk,
							tooltip: "Make the block template state that the user's talk page access has been removed",
						},
						{
							label: 'User blocked from sending email',
							name: 'noemail_template',
							checked: this.field_template_options.noemail_template,
							tooltip:
								"If the area is not provided, make the block template state that the user's email access has been removed",
						},
						{
							label: 'User blocked from creating accounts',
							name: 'nocreate_template',
							checked: this.field_template_options.nocreate_template,
							tooltip:
								"If the area is not provided, make the block template state that the user's ability to create accounts has been removed",
						},
					],
				});
			}

			var $previewlink = $('<a id="twinkleblock-preview-link">Preview</a>');
			$previewlink.off('click').on('click', () => {
				this.preview($form[0]);
			});
			$previewlink.css({ cursor: 'pointer' });
			field_template_options.append({ type: 'div', id: 'blockpreview', label: [$previewlink[0]] });
			field_template_options.append({ type: 'div', id: 'twinkleblock-previewbox', style: 'display: none' });
		} else if (field_preset) {
			// Only visible for arbitration enforcement, toggled in change_preset
			field_preset.append(dsSelectSettings);
		}

		var oldfield;
		if (field_preset) {
			oldfield = $form.find('fieldset[name="field_preset"]')[0];
			oldfield.parentNode.replaceChild(field_preset.render(), oldfield);
		} else {
			$form.find('fieldset[name="field_preset"]').hide();
		}
		if (field_block_options) {
			oldfield = $form.find('fieldset[name="field_block_options"]')[0];
			oldfield.parentNode.replaceChild(field_block_options.render(), oldfield);
			$form.find('fieldset[name="field_64"]').show();

			$form.find('[name=pagerestrictions]').select2({
				width: '100%',
				placeholder: 'Select pages to block user from',
				language: {
					errorLoading: function () {
						return 'Incomplete or invalid search term';
					},
				},
				maximumSelectionLength: 10, // Software limitation [[phab:T202776]]
				minimumInputLength: 1, // prevent ajax call when empty
				ajax: {
					url: mw.util.wikiScript('api'),
					dataType: 'json',
					delay: 100,
					data: function (params) {
						var title = mw.Title.newFromText(params.term);
						if (!title) {
							return;
						}
						return {
							action: 'query',
							format: 'json',
							list: 'allpages',
							apfrom: title.title,
							apnamespace: title.namespace,
							aplimit: '10',
						};
					},
					processResults: function (data) {
						return {
							results: data.query.allpages.map(function (page) {
								var title = mw.Title.newFromText(page.title, page.ns).toText();
								return {
									id: title,
									text: title,
								};
							}),
						};
					},
				},
				templateSelection: function (choice) {
					return $('<a>')
						.text(choice.text)
						.attr({
							href: mw.util.getUrl(choice.text),
							target: '_blank',
						});
				},
			});

			$form.find('[name=namespacerestrictions]').select2({
				width: '100%',
				matcher: Morebits.select2.matchers.wordBeginning,
				language: {
					searching: Morebits.select2.queryInterceptor,
				},
				templateResult: Morebits.select2.highlightSearchMatches,
				placeholder: 'Select namespaces to block user from',
			});

			mw.util.addCSS(
				// Reduce padding
				'.select2-results .select2-results__option { padding-top: 1px; padding-bottom: 1px; }' +
					// Adjust font size
					'.select2-container .select2-dropdown .select2-results { font-size: 13px; }' +
					'.select2-container .selection .select2-selection__rendered { font-size: 13px; }' +
					// Remove black border
					'.select2-container--default.select2-container--focus .select2-selection--multiple { border: 1px solid #aaa; }' +
					// Make the tiny cross larger
					'.select2-selection__choice__remove { font-size: 130%; }'
			);
		} else {
			$form.find('fieldset[name="field_block_options"]').hide();
			$form.find('fieldset[name="field_64"]').hide();
			// Clear select2 options
			$form.find('[name=pagerestrictions]').val(null).trigger('change');
			$form.find('[name=namespacerestrictions]').val(null).trigger('change');
		}

		if (field_template_options) {
			oldfield = $form.find('fieldset[name="field_template_options"]')[0];
			oldfield.parentNode.replaceChild(field_template_options.render(), oldfield);
			e.target.form.root.previewer = new Morebits.wiki.preview(
				$(e.target.form.root).find('#twinkleblock-previewbox').last()[0]
			);
		} else {
			$form.find('fieldset[name="field_template_options"]').hide();
		}

		// Any block, including ranges
		if (this.currentBlockInfo) {
			// false for an ip covered by a range or a smaller range within a larger range;
			// true for a user, single ip block, or the exact range for a range block
			var sameUser = this.blockedUserName === this.relevantUserName;

			Morebits.status.init($('div[name="currentblock"] span').last()[0]);
			var statusStr =
				this.relevantUserName + ' is ' + (this.currentBlockInfo.partial ? 'partially blocked' : 'blocked sitewide');

			// Range blocked
			if (this.currentBlockInfo.rangestart !== this.currentBlockInfo.rangeend) {
				if (sameUser) {
					statusStr += ' as a rangeblock';
				} else {
					statusStr +=
						' within a' +
						(Morebits.ip.get64(this.relevantUserName) === this.blockedUserName ? ' /64' : '') +
						' rangeblock';
					// Link to the full range
					var $rangeblockloglink = $('<span>').append(
						$(
							'<a target="_blank" href="' +
								mw.util.getUrl('Special:Log', {
									action: 'view',
									page: this.blockedUserName,
									type: 'block',
								}) +
								'">' +
								this.blockedUserName +
								'</a>)'
						)
					);
					statusStr += ' (' + $rangeblockloglink.html() + ')';
				}
			}

			if (this.currentBlockInfo.expiry === 'infinity') {
				statusStr += ' (indefinite)';
			} else if (new Morebits.date(this.currentBlockInfo.expiry).isValid()) {
				statusStr += ' (expires ' + new Morebits.date(this.currentBlockInfo.expiry).calendar('utc') + ')';
			}

			var infoStr = 'This form will';
			if (sameUser) {
				infoStr += ' change that block';
				if (this.currentBlockInfo.partial !== partialBox) {
					infoStr += ', converting it to a ' + (partialBox ? 'partial block' : 'sitewide block');
				}
				infoStr += '.';
			} else {
				infoStr += ' add an additional ' + (partialBox ? 'partial ' : '') + 'block.';
			}

			Morebits.status.warn(statusStr, infoStr);

			// Default to the current block conditions on intial form generation
			this.update_form(e, this.currentBlockInfo);
		}

		// This is where T146628 really comes into play: a rangeblock will
		// only return the correct block log if wgRelevantUserName is the
		// exact range, not merely a funtional equivalent
		if (this.hasBlockLog) {
			var $blockloglink = $('<span>').append(
				$(
					'<a target="_blank" href="' +
						mw.util.getUrl('Special:Log', {
							action: 'view',
							page: this.relevantUserName,
							type: 'block',
						}) +
						'">block log</a>)'
				)
			);
			if (!this.currentBlockInfo) {
				if (this.lastBlockLogEntry.action === 'unblock') {
					$blockloglink.append(
						' (unblocked ' + new Morebits.date(this.lastBlockLogEntry.timestamp).calendar('utc') + ')'
					);
				} else {
					// block or reblock
					$blockloglink.append(
						' (' +
							this.lastBlockLogEntry.params.duration +
							', expired ' +
							new Morebits.date(this.lastBlockLogEntry.params.expiry).calendar('utc') +
							')'
					);
				}
			}

			Morebits.status.init($('div[name="hasblocklog"] span').last()[0]);
			Morebits.status.warn(
				this.currentBlockInfo
					? 'Previous blocks'
					: 'This ' + (Morebits.ip.isRange(this.relevantUserName) ? 'range' : 'user') + ' has been blocked in the past',
				$blockloglink[0]
			);
		}

		// Make sure all the fields are correct based on initial defaults
		if (blockBox) {
			this.change_preset(e);
		} else if (templateBox) {
			this.change_template(e);
		}
	}

	transformBlockPresets() {
		// supply sensible defaults
		$.each(this.blockPresetsInfo, (preset, settings) => {
			settings.summary = settings.summary || settings.reason;
			settings.sig = settings.sig !== undefined ? settings.sig : 'yes';
			settings.indefinite = settings.indefinite || Morebits.string.isInfinity(settings.expiry);

			if (!this.isRegistered && settings.indefinite) {
				settings.expiry = '31 hours';
			} else {
				settings.expiry = settings.expiry || '31 hours';
			}

			this.blockPresetsInfo[preset] = settings;
		});
	}

	filtered_block_groups(group, show_template) {
		return $.map(group, (blockGroup) => {
			var list = $.map(blockGroup.list, (blockPreset) => {
				switch (blockPreset.value) {
					case 'uw-talkrevoked':
						if (this.blockedUserName !== this.relevantUserName) {
							return;
						}
						break;
					case 'rangeblock':
						if (!Morebits.ip.isRange(this.relevantUserName)) {
							return;
						}
						blockPreset.selected = !Morebits.ip.get64(this.relevantUserName);
						break;
					case 'CheckUser block':
					case 'checkuserblock-account':
					case 'checkuserblock-wide':
						if (!Morebits.userIsInGroup('checkuser')) {
							return;
						}
						break;
					case 'oversightblock':
						if (!Morebits.userIsInGroup('oversight')) {
							return;
						}
						break;
					default:
						break;
				}

				var blockSettings = this.blockPresetsInfo[blockPreset.value];
				var registrationRestrict = blockSettings.forRegisteredOnly
					? this.isRegistered
					: blockSettings.forAnonOnly
					? !this.isRegistered
					: true;
				if (!(blockSettings.templateName && show_template) && registrationRestrict) {
					var templateName = blockSettings.templateName || blockPreset.value;
					return {
						label: (show_template ? '{{' + templateName + '}}: ' : '') + blockPreset.label,
						value: blockPreset.value,
						data: [
							{
								name: 'template-name',
								value: templateName,
							},
						],
						selected: !!blockPreset.selected,
						disabled: !!blockPreset.disabled,
					};
				}
			});
			if (list.length) {
				return {
					label: blockGroup.label,
					list: list,
				};
			}
		});
	}

	change_preset(e) {
		var form = e.target.form,
			key = form.preset.value;
		if (!key) {
			return;
		}

		this.update_form(e, this.blockPresetsInfo[key]);
		if (form.template) {
			form.template.value = this.blockPresetsInfo[key].templateName || key;
			this.change_template(e);
		} else {
			Morebits.quickForm.setElementVisibility(form.dstopic.parentNode, key === 'uw-aeblock' || key === 'uw-aepblock');
		}
	}

	change_expiry(e) {
		var expiry = e.target.form.expiry;
		if (e.target.value === 'custom') {
			Morebits.quickForm.setElementVisibility(expiry.parentNode, true);
		} else {
			Morebits.quickForm.setElementVisibility(expiry.parentNode, false);
			expiry.value = e.target.value;
		}
	}

	seeAlsos = [];

	toggle_see_alsos(e: QuickFormEvent) {}

	update_form(e, data) {
		var form = e.target.form,
			expiry = data.expiry;

		// don't override original expiry if useInitialOptions is set
		if (!data.useInitialOptions) {
			if (Date.parse(expiry)) {
				expiry = new Date(expiry).toUTCString();
				form.expiry_preset.value = 'custom';
			} else {
				form.expiry_preset.value = data.expiry || 'custom';
			}

			form.expiry.value = expiry;
			if (form.expiry_preset.value === 'custom') {
				Morebits.quickForm.setElementVisibility(form.expiry.parentNode, true);
			} else {
				Morebits.quickForm.setElementVisibility(form.expiry.parentNode, false);
			}
		}

		// disable autoblock if blocking a bot
		if (this.userIsBot) {
			data.autoblock = false;
		}

		$(form)
			.find('[name=field_block_options]')
			.find(':checkbox')
			.each(function (i, el: HTMLInputElement) {
				// don't override original options if useInitialOptions is set
				if (data.useInitialOptions && data[el.name] === undefined) {
					return;
				}

				var check = data[el.name] === '' || !!data[el.name];
				$(el).prop('checked', check);
			});

		if (data.prependReason && data.reason) {
			form.reason.value = data.reason + '; ' + form.reason.value;
		} else {
			form.reason.value = data.reason || '';
		}

		// Clear and/or set any partial page or namespace restrictions
		if (form.pagerestrictions) {
			var $pageSelect = $(form).find('[name=pagerestrictions]');
			var $namespaceSelect = $(form).find('[name=namespacerestrictions]');

			// Respect useInitialOptions by clearing data when switching presets
			// In practice, this will always clear, since no partial presets use it
			if (!data.useInitialOptions) {
				$pageSelect.val(null).trigger('change');
				$namespaceSelect.val(null).trigger('change');
			}

			// Add any preset options; in practice, just used for prior block settings
			if (data.restrictions) {
				if (data.restrictions.pages && !$pageSelect.val().length) {
					var pages = data.restrictions.pages.map(function (pr) {
						return pr.title;
					});
					// since page restrictions use an ajax source, we
					// short-circuit that and just add a new option
					pages.forEach(function (page) {
						if (!$pageSelect.find("option[value='" + $.escapeSelector(page) + "']").length) {
							var newOption = new Option(page, page, true, true);
							$pageSelect.append(newOption);
						}
					});
					$pageSelect.val($pageSelect.val().concat(pages)).trigger('change');
				}
				if (data.restrictions.namespaces) {
					$namespaceSelect.val($namespaceSelect.val().concat(data.restrictions.namespaces)).trigger('change');
				}
			}
		}
	}

	change_template(e) {
		var form = e.target.form,
			value = form.template.value,
			settings = this.blockPresetsInfo[value];

		var blockBox = $(form).find('[name=actiontype][value=block]').is(':checked');
		var partialBox = $(form).find('[name=actiontype][value=partial]').is(':checked');
		var templateBox = $(form).find('[name=actiontype][value=template]').is(':checked');

		// Block form is not present
		if (!blockBox) {
			if (settings.indefinite || settings.nonstandard) {
				if (this.prev_template_expiry === null) {
					this.prev_template_expiry = form.template_expiry.value || '';
				}
				form.template_expiry.parentNode.style.display = 'none';
				form.template_expiry.value = 'infinity';
			} else if (form.template_expiry.parentNode.style.display === 'none') {
				if (this.prev_template_expiry !== null) {
					form.template_expiry.value = this.prev_template_expiry;
					this.prev_template_expiry = null;
				}
				form.template_expiry.parentNode.style.display = 'block';
			}
			if (this.prev_template_expiry) {
				form.expiry.value = this.prev_template_expiry;
			}
			Morebits.quickForm.setElementVisibility(form.notalk.parentNode, !settings.nonstandard);
			// Partial
			Morebits.quickForm.setElementVisibility(form.noemail_template.parentNode, partialBox);
			Morebits.quickForm.setElementVisibility(form.nocreate_template.parentNode, partialBox);
		} else if (templateBox) {
			// Only present if block && template forms both visible
			Morebits.quickForm.setElementVisibility(
				form.blank_duration.parentNode,
				!settings.indefinite && !settings.nonstandard
			);
		}

		Morebits.quickForm.setElementVisibility(form.dstopic.parentNode, value === 'uw-aeblock' || value === 'uw-aepblock');

		// Only particularly relevant if template form is present
		Morebits.quickForm.setElementVisibility(form.article.parentNode, settings && !!settings.pageParam);
		Morebits.quickForm.setElementVisibility(form.block_reason.parentNode, settings && !!settings.reasonParam);

		// Partial block
		Morebits.quickForm.setElementVisibility(form.area.parentNode, partialBox && !blockBox);

		form.root.previewer.closePreview();
	}

	prev_template_expiry = null;

	preview(form: HTMLFormElement) {
		var params = {
			article: form.article.value,
			blank_duration: form.blank_duration ? form.blank_duration.checked : false,
			disabletalk: form.disabletalk.checked || (form.notalk ? form.notalk.checked : false),
			expiry: form.template_expiry ? form.template_expiry.value : form.expiry.value,
			hardblock: this.isRegistered ? form.autoblock.checked : form.hardblock.checked,
			indefinite: Morebits.string.isInfinity(form.template_expiry ? form.template_expiry.value : form.expiry.value),
			reason: form.block_reason.value,
			template: form.template.value,
			dstopic: form.dstopic.value,
			partial: $(form).find('[name=actiontype][value=partial]').is(':checked'),
			pagerestrictions: $(form.pagerestrictions).val() || [],
			namespacerestrictions: $(form.namespacerestrictions).val() || [],
			noemail: form.noemail.checked || (form.noemail_template ? form.noemail_template.checked : false),
			nocreate: form.nocreate.checked || (form.nocreate_template ? form.nocreate_template.checked : false),
			area: form.area.value,
		};

		var templateText = this.getBlockNoticeWikitext(params);

		form.previewer.beginRender(templateText, 'User_talk:' + this.relevantUserName); // Force wikitext/correct username
	}

	evaluate(e) {
		var $form = $(e.target),
			toBlock = $form.find('[name=actiontype][value=block]').is(':checked'),
			toWarn = $form.find('[name=actiontype][value=template]').is(':checked'),
			toPartial = $form.find('[name=actiontype][value=partial]').is(':checked'),
			blockoptions = {},
			templateoptions = {};

		this.saveFieldset($form.find('[name=field_block_options]'));
		this.saveFieldset($form.find('[name=field_template_options]'));

		blockoptions = this.field_block_options;
		templateoptions = this.field_template_options;

		templateoptions.disabletalk = !!(templateoptions.disabletalk || blockoptions.disabletalk);
		templateoptions.hardblock = !!blockoptions.hardblock;

		delete blockoptions.expiry_preset; // remove extraneous

		// Partial API requires this to be gone, not false or 0
		if (toPartial) {
			blockoptions.partial = templateoptions.partial = true;
		}
		templateoptions.pagerestrictions = $form.find('[name=pagerestrictions]').val() || [];
		templateoptions.namespacerestrictions = $form.find('[name=namespacerestrictions]').val() || [];
		// Format for API here rather than in saveFieldset
		blockoptions.pagerestrictions = templateoptions.pagerestrictions.join('|');
		blockoptions.namespacerestrictions = templateoptions.namespacerestrictions.join('|');

		// use block settings as warn options where not supplied
		templateoptions.summary = templateoptions.summary || blockoptions.reason;
		templateoptions.expiry = templateoptions.template_expiry || blockoptions.expiry;

		if (toBlock) {
			if (blockoptions.partial) {
				// Preempt API/Morebits.wiki.user errors
				if (blockoptions.disabletalk && blockoptions.namespacerestrictions.indexOf('3') === -1) {
					return alert(
						'Partial blocks cannot prevent talk page access unless also restricting them from editing User talk space!'
					);
				}
				if (!blockoptions.namespacerestrictions && !blockoptions.pagerestrictions) {
					if (!blockoptions.noemail && !blockoptions.nocreate) {
						// Blank entries technically allowed [[phab:T208645]]
						return alert(
							'No pages or namespaces were selected, nor were email or account creation restrictions applied; please select at least one option to apply a partial block!'
						);
					} else if (
						(templateoptions.template !== 'uw-epblock' || $form.find('select[name="preset"]').val() !== 'uw-epblock') &&
						// Don't require confirmation if email harassment defaults are set
						!confirm(
							'You are about to block with no restrictions on page or namespace editing, are you sure you want to proceed?'
						)
					) {
						return;
					}
				}
			}
			if (!blockoptions.expiry) {
				return alert('Please provide an expiry!');
			} else if (Morebits.string.isInfinity(blockoptions.expiry) && !this.isRegistered) {
				return alert("Can't indefinitely block an IP address!");
			}
			if (!blockoptions.reason) {
				return alert('Please provide a reason for the block!');
			}

			Morebits.simpleWindow.setButtonsEnabled(false);
			Morebits.status.init(e.target);

			// Message doesn't resolve???
			var user = new Morebits.wiki.user(this.relevantUserName, 'Executing block');
			user.setChangeTags(Twinkle.changeTags);

			/*
			  Check if block status changed while processing the form.

			  There's a lot to consider here. list=blocks provides the
			  current block status, but won't indicate if a non-blocked
			  user is blocked then unblocked. This should be rare, but we
			  thus need to check list=logevents, which has a nicely
			  updating logid parameter. We can't rely just on that,
			  though, since it doesn't account for blocks that have
			  naturally expired.

			  Thus, we use both. Using some ternaries, the logid variables
			  are false if there's no response from logevents, so if they
			  aren't equivalent we defintely have a changed entry (send
			  confirmation). If they are, then either the user was never
			  blocked (the block statuses will be equal, no confirmation)
			  or there's no new block, in which case either a block
			  expired (different statuses, confirmation) or the same block
			  is still active (same status, no confirmation).
			*/
			user.load(() => {
				// Process the options stored in blockoptions, here after load should override any defaults
				// Boolean-flipped options
				blockoptions.anononly = !blockoptions.hardblock;
				blockoptions.allowusertalk = !blockoptions.disabletalk;

				// In theory we could probably process field_block_options to get this list,
				// adding partial status and removing expiry_preset, reason, and the see_alsos
				// (that's basically what blockoptions is), but in practice we want everything,
				// regardless of whether they're set or not, and just using all the available
				// methods in Morebits.wiki.user guards against any future issues.
				[
					'expiry',
					'watchuser',
					'reason',
					'partial',
					'allowusertalk',
					'anononly',
					'autoblock',
					'nocreate',
					'noemail',
					'reblock',
				].forEach(function (param) {
					// e.g. `expiry` -> `user.setExpiry(blockoptions.expiry)`
					user['set' + Morebits.string.toUpperCaseFirstChar(param)](blockoptions[param]);
				});
				if (blockoptions.partial) {
					if (blockoptions.pagerestrictions) {
						user.setPartialPages(blockoptions.pagerestrictions);
					}
					if (blockoptions.namespacerestrictions) {
						user.setPartialNamespaces(blockoptions.namespacerestrictions);
					}
				}

				var block = user.getBlockInfo();
				var logevents = user.getLastBlockLogEntry();
				var logid = logevents ? logevents.logid : false;

				if (logid !== this.lastBlockLogId || !!block !== !!this.currentBlockInfo) {
					var message = 'The block status of ' + user.getUserName() + ' has changed. ';
					if (block) {
						message += 'New status: ';
					} else {
						message += 'Last entry: ';
					}

					var logExpiry = '';
					// Only defined if there was ever a block, and we're only ever here if there was ever a block
					// That is: if there's a difference in logids, then this is defined;
					// if there isn't but the block status has changed, this is defined
					if (logevents.params.duration) {
						if (logevents.params.duration === 'infinity') {
							logExpiry = 'indefinitely';
						} else {
							var expiryDate = new Morebits.date(logevents.params.expiry);
							logExpiry += (expiryDate.isBefore(new Date()) ? ', expired ' : ' until ') + expiryDate.calendar();
						}
					} else {
						// no duration, action=unblock, just show timestamp
						logExpiry = ' ' + new Morebits.date(logevents.timestamp).calendar();
					}
					message +=
						Morebits.string.toUpperCaseFirstChar(logevents.action) +
						'ed by ' +
						logevents.user +
						logExpiry +
						' for "' +
						logevents.comment +
						'". Do you want to override with your settings?';

					if (!confirm(message)) {
						Morebits.status.info('Executing block', 'Canceled by user');
						return;
					}
					user.setReblock(true); // Writing over a block will fail otherwise
				}

				// execute block
				user.block(() => {
					if (toWarn) {
						this.issue_template(templateoptions);
					}
				});
			});
		} else if (toWarn) {
			Morebits.simpleWindow.setButtonsEnabled(false);

			Morebits.status.init(e.target);
			this.issue_template(templateoptions);
		} else {
			return alert('Please give Twinkle something to do!');
		}
	}

	field_template_options: {
		block_reason: string;
		notalk: boolean;
		noemail_template: boolean;
		nocreate_template: boolean;
	};

	issue_template(formData) {
		// Use wgRelevantUserName to ensure the block template goes to a single IP and not to the
		// "talk page" of an IP range (which does not exist)
		var userTalkPage = 'User_talk:' + mw.config.get('wgRelevantUserName');

		var params = $.extend(formData, {
			messageData: this.blockPresetsInfo[formData.template],
			reason: this.field_template_options.block_reason,
			disabletalk: this.field_template_options.notalk,
			noemail: this.field_template_options.noemail_template,
			nocreate: this.field_template_options.nocreate_template,
		});

		Morebits.wiki.actionCompleted.redirect = userTalkPage;
		Morebits.wiki.actionCompleted.notice = 'Actions complete, loading user talk page in a few seconds';

		var wikipedia_page = new Morebits.wiki.page(userTalkPage, 'User talk page modification');
		wikipedia_page.setCallbackParameters(params);
		wikipedia_page.load((pageobj) => this.main(pageobj));
	}

	getBlockNoticeWikitext(params) {
		var text = '{{',
			settings = this.blockPresetsInfo[params.template];
		if (!settings.nonstandard) {
			text += 'subst:' + params.template;
			if (params.article && settings.pageParam) {
				text += '|page=' + params.article;
			}
			if (params.dstopic) {
				text += '|topic=' + params.dstopic;
			}

			if (!/te?mp|^\s*$|min/.exec(params.expiry)) {
				if (params.indefinite) {
					text += '|indef=yes';
				} else if (!params.blank_duration && !new Morebits.date(params.expiry).isValid()) {
					// Block template wants a duration, not date
					text += '|time=' + params.expiry;
				}
			}

			if (!this.isRegistered && !params.hardblock) {
				text += '|anon=yes';
			}

			if (params.reason) {
				text += '|reason=' + params.reason;
			}
			if (params.disabletalk) {
				text += '|notalk=yes';
			}

			// Currently, all partial block templates are "standard"
			// Building the template, however, takes a fair bit of logic
			if (params.partial) {
				if (params.pagerestrictions.length || params.namespacerestrictions.length) {
					var makeSentence = function (array) {
						if (array.length < 3) {
							return array.join(' and ');
						}
						var last = array.pop();
						return array.join(', ') + ', and ' + last;
					};
					text += '|area=' + (params.indefinite ? 'certain ' : 'from certain ');
					if (params.pagerestrictions.length) {
						text +=
							'pages (' +
							makeSentence(
								params.pagerestrictions.map(function (p) {
									return '[[:' + p + ']]';
								})
							);
						text += params.namespacerestrictions.length ? ') and certain ' : ')';
					}
					if (params.namespacerestrictions.length) {
						// 1 => Talk, 2 => User, etc.
						var namespaceNames = params.namespacerestrictions.map(function (id) {
							return menuFormattedNamespaces[id];
						});
						text += '[[Wikipedia:Namespace|namespaces]] (' + makeSentence(namespaceNames) + ')';
					}
				} else if (params.area) {
					text += '|area=' + params.area;
				} else {
					if (params.noemail) {
						text += '|email=yes';
					}
					if (params.nocreate) {
						text += '|accountcreate=yes';
					}
				}
			}
		} else {
			text += params.template;
		}

		if (settings.sig) {
			text += '|sig=' + settings.sig;
		}
		return text + '}}';
	}

	main(pageobj) {
		var params = pageobj.getCallbackParameters(),
			date = new Morebits.date(pageobj.getLoadTime()),
			messageData = params.messageData,
			text;

		params.indefinite = Morebits.string.isInfinity(params.expiry);

		if (params.indefinite && getPref('blankTalkpageOnIndefBlock') && params.template !== 'uw-lblock') {
			Morebits.status.info(
				'Info',
				'Blanking talk page per preferences and creating a new talk page section for this month'
			);
			text = date.monthHeader() + '\n';
		} else {
			text = pageobj.getPageText();

			var dateHeaderRegex = date.monthHeaderRegex(),
				dateHeaderRegexLast,
				dateHeaderRegexResult;
			while ((dateHeaderRegexLast = dateHeaderRegex.exec(text)) !== null) {
				dateHeaderRegexResult = dateHeaderRegexLast;
			}
			// If dateHeaderRegexResult is null then lastHeaderIndex is never checked. If it is not null but
			// \n== is not found, then the date header must be at the very start of the page. lastIndexOf
			// returns -1 in this case, so lastHeaderIndex gets set to 0 as desired.
			var lastHeaderIndex = text.lastIndexOf('\n==') + 1;

			if (text.length > 0) {
				text += '\n\n';
			}

			if (!dateHeaderRegexResult || dateHeaderRegexResult.index !== lastHeaderIndex) {
				Morebits.status.info('Info', 'Will create a new talk page section for this month, as none was found');
				text += date.monthHeader() + '\n';
			}
		}

		params.expiry = typeof params.template_expiry !== 'undefined' ? params.template_expiry : params.expiry;

		text += this.getBlockNoticeWikitext(params);

		// build the edit summary
		var summary = messageData.summary;
		if (messageData.suppressArticleInSummary !== true && params.article) {
			summary += ' on [[:' + params.article + ']]';
		}
		summary += '.';

		pageobj.setPageText(text);
		pageobj.setEditSummary(summary);
		pageobj.setChangeTags(Twinkle.changeTags);
		pageobj.setWatchlist(getPref('watchWarnings'));
		pageobj.save();
	}
}
