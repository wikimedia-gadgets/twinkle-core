import { Twinkle } from '../twinkle';
import { Dialog } from '../Dialog';
import { link, LogEvent, obj_entries } from '../utils';
import { msg } from '../messenger';
import { TwinkleModule } from '../twinkleModule';
import { getPref } from '../Config';
import { User } from '../User';
import type { ApiBlockParams } from 'types-mediawiki/api_params';
import isInfinity = Morebits.string.isInfinity;

export type BlockPresetInfo = {
	expiry?: string;
	forRegisteredOnly?: boolean;
	forAnonOnly?: boolean;
	forRangeOnly?: boolean;
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
	requireGroup?: string;
};

/**
 * Module used for blocking users and/or issuing block templates.
 *
 * **Localisation**: This class is abstract – you need to implement
 * {@link getBlockNoticeWikitextAndSummary}.
 * Also, the following fields may need to be customised:
 * - {@link blockPresetsInfo}
 * - {@link blockGroups}
 * - {@link blockGroupsPartial}
 * - {@link defaultBlockTemplate}
 * - {@link defaultIndefBlockTemplate}
 * - {@link defaultPartialBlockTemplate}
 * - {@link defaultIndefPartialBlockTemplate}
 * - {@link defaultAnonBlockTemplate}
 * - {@link disablePartialBlockNamespaces}
 * - {@link ipBlockExpiryDefault}
 *
 */
export abstract class BlockCore extends TwinkleModule {
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
	readonly menuFormattedNamespaces = $.extend({}, mw.config.get('wgFormattedNamespaces'));

	dsinfo: Record<string, { code: string; page?: string }>;

	constructor() {
		super();
		this.menuFormattedNamespaces[0] = msg('blanknamespace');
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

	field_block_options: {
		disabletalk?: boolean;
		nocreate?: boolean;
		noemail?: boolean;
		hardblock?: boolean;
		reason?: string;
		expiry?: string;
		autoblock?: boolean;
		watchuser?: string;
	};
	field_template_options: {
		template?: string;
		block_reason?: string;
		notalk?: boolean;
		noemail_template?: boolean;
		nocreate_template?: boolean;
		template_expiry?: string;
		blank_duration?: boolean;
	};
	currentBlockInfo: any;

	Window: Morebits.simpleWindow;

	makeWindow() {
		if (this.relevantUserName === mw.config.get('wgUserName') && !confirm(msg('block-self-warn'))) {
			return;
		}

		this.currentBlockInfo = undefined;
		this.field_block_options = {};
		this.field_template_options = {};

		var Window = new Dialog(650, 530);
		// pass username to message, need to be verbose about who we're blocking
		Window.setTitle(msg('block-window-title', this.relevantUserName));
		Window.setFooterLinks(this.footerlinks);

		// Always added, hidden later if actual user not blocked
		Window.addFooterLink(msg('unblock-label'), `Special:Unblock/${this.relevantUserName}`, true);

		var form = new Morebits.quickForm((e) => this.evaluate(e));
		var actionfield = form.append({
			type: 'field',
			label: 'Type of action',
		});
		actionfield.append({
			type: 'checkbox',
			event: this.change_action.bind(this),
			list: [
				{
					label: msg('block-action'),
					value: 'block',
					name: 'block',
					tooltip: msg('block-action-tooltip'),
					checked: true,
				},
				{
					label: msg('block-partial'),
					value: 'partial',
					name: 'partial',
					tooltip: msg('block-partial-tooltip'),
					checked: getPref('defaultToPartialBlocks'), // Overridden if already blocked
				},
				{
					label: msg('block-tag'),
					value: 'tag',
					name: 'tag',
					tooltip: msg('block-tag-tooltip'),
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
		var subnet64 = Morebits.ip.get64(mw.config.get('wgRelevantUserName'));
		if (subnet64 && subnet64 !== mw.config.get('wgRelevantUserName')) {
			var block64field = form.append({
				type: 'field',
				label: msg('block-64-field-label'),
				name: 'field_64',
			});
			block64field.append({
				type: 'div',
				style: 'margin-bottom: 0.5em',
				label: msg('block-64-help', subnet64),
			});
			block64field.append({
				type: 'checkbox',
				name: 'block64',
				event: this.change_block64.bind(this),
				list: [
					{
						// In case the user closes and reopens the form
						checked: this.relevantUserName !== mw.config.get('wgRelevantUserName'),
						label: msg('block-64-label'),
						value: 'block64',
						tooltip: !Morebits.ip.isRange(mw.config.get('wgRelevantUserName'))
							? msg('block-64-template', mw.config.get('wgRelevantUserName'))
							: '',
					},
				],
			});
		}

		form.append({ type: 'field', label: msg('preset'), name: 'field_preset' });
		form.append({ type: 'field', label: msg('block-tag-options'), name: 'field_template_options' });
		form.append({ type: 'field', label: msg('block-block-options'), name: 'field_block_options' });

		form.append({ type: 'submit' });

		var result = form.render();
		Window.setContent(result);
		Window.display();
		result.root = result;

		var userobj = new User(this.relevantUserName, msg('fetching-userinfo'));
		userobj.load().then(
			() => {
				this.processUserInfo(userobj);

				// Toggle initial partial state depending on prior block type,
				// will override the defaultToPartialBlocks pref
				if (this.blockedUserName === this.relevantUserName) {
					$(result.partial).prop('checked', this.currentBlockInfo.partial);
				}

				// clean up preset data (defaults, etc.), done exactly once, must be before this.change_action is called
				this.transformBlockPresets();

				// init the controls after user and block info have been fetched
				var evt = document.createEvent('Event');
				evt.initEvent('change', true, true);
				result.block.dispatchEvent(evt);
			},
			() => {
				Morebits.status.init($('div[name="currentblock"] span').last()[0]);
				Morebits.status.warn(msg('error'), msg('fetching-userinfo-error'));
			}
		);
	}

	isRegistered: boolean;
	userIsBot: boolean;
	hasBlockLog: boolean;
	lastBlockLogEntry: LogEvent;
	lastBlockLogId: number | false;

	fetchedData = {};

	processUserInfo(userobj: User) {
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

		// Toggle unblock link (and its trailing bullet) if not the user in question; always first
		var $unblockLink = $('.morebits-dialog-footerlinks a').first();
		$unblockLink
			.toggle(this.blockedUserName === this.relevantUserName)
			.next()
			.toggle(this.blockedUserName === this.relevantUserName);

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
	}

	/**
	 * Saves the values of form entries in a fieldset to
	 * this[fieldset_name].
	 * @param fieldset
	 */
	saveFieldset(fieldset: HTMLFieldSetElement | JQuery) {
		this[$(fieldset).prop('name')] = {};
		$(fieldset)
			.serializeArray()
			.forEach((el) => {
				// namespaces and pages for partial blocks are overwritten
				// here, but we're handling them elsewhere so that's fine
				this[$(fieldset).prop('name')][el.name] = el.value;
			});
		return this[$(fieldset).prop('name')];
	}

	change_block64(e) {
		var form = e.target.form,
			$form = $(e.target.form),
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
		$(form.tag).prop('disabled', originalIsRange).prop('checked', !originalIsRange);

		// Refetch/reprocess user info then regenerate the main content
		var regenerateForm = () => {
			// Tweak titlebar text. We could save the dialog
			// at initialization and then use `.setTitle`, but that
			// swallows the scriptName and requires `.display`ing, which jumps the
			// window.
			var titleBar = document.querySelector('.ui-dialog-title').firstChild.nextSibling;
			titleBar.nodeValue = titleBar.nodeValue.replace(priorName, this.relevantUserName);
			// Tweak unblock link
			var unblockLink = document.querySelector('.morebits-dialog-footerlinks a') as HTMLAnchorElement;
			unblockLink.href = unblockLink.href.replace(priorName, this.relevantUserName);
			unblockLink.title = unblockLink.title.replace(priorName, this.relevantUserName);

			// Correct partial state
			$(form.partial).prop('checked', getPref('defaultToPartialBlocks'));
			if (this.blockedUserName === this.relevantUserName) {
				$(form.partial).prop('checked', this.currentBlockInfo.partial);
			}

			// Set content appropriately
			this.change_action(e);
		};

		if (this.fetchedData[this.relevantUserName]) {
			this.processUserInfo(this.fetchedData[this.relevantUserName]);
			regenerateForm();
		} else {
			new Morebits.wiki.user(this.relevantUserName, msg('fetching-userinfo')).load(
				(userobj) => {
					this.processUserInfo(userobj);
					regenerateForm();
				},
				() => {
					Morebits.status.init($('div[name="currentblock"] span').last()[0]);
					Morebits.status.warn(msg('error'), msg('fetching-userinfo-error'));
				}
			);
		}
	}

	/**
	 * Default generic block template
	 */
	defaultBlockTemplate = 'uw-block';
	/**
	 * Default generic block template for anonymous user blocks
	 */
	defaultAnonBlockTemplate = 'uw-ablock';
	/**
	 * Default generic block template for indefinite blocks
	 */
	defaultIndefBlockTemplate = 'uw-blockindef';
	/**
	 * Default generic block template for partial blocks
	 */
	defaultPartialBlockTemplate = 'uw-pblock';
	/**
	 * Default generic block template for indefinite partial blocks
	 */
	defaultIndefPartialBlockTemplate = 'uw-pblockindef';

	/**
	 * Do not allow partial blocking users for these namespaces.
	 * Special/Media namespaces don't need to be included here.
	 */
	disablePartialBlockNamespaces: number[];

	/**
	 * Called when any of the checkboxes in "type of action" or IPv6 /64 block are toggled.
	 * @param e
	 */
	change_action(e) {
		var field_preset,
			field_template_options,
			field_block_options,
			form = e.target.form,
			$form = $(e.target.form);

		var input = Morebits.quickForm.getInputData(form) as {
			block: boolean;
			tag: boolean;
			partial: boolean;
		};
		var blockGroup = input.partial ? this.blockGroupsPartial : this.blockGroups;
		var $partial = $(form.partial);
		$partial.prop('disabled', !input.block && !input.tag);

		// Add current block parameters as default preset
		var prior: quickFormElementData = { label: msg('block-prior-label') };
		if (this.blockedUserName === this.relevantUserName) {
			this.blockPresetsInfo.prior = this.currentBlockInfo;
			// value not a valid template selection, chosen below by setting templateName
			prior.list = [{ label: msg('block-prior-label'), value: 'prior', selected: true }];

			// Arrays of objects are annoying to check
			if (!blockGroup.some((bg) => bg.label === prior.label)) {
				blockGroup.push(prior);
			}

			// Always ensure proper template exists/is selected when switching modes
			if (input.partial) {
				this.blockPresetsInfo.prior.templateName = isInfinity(this.currentBlockInfo.expiry)
					? this.defaultIndefPartialBlockTemplate
					: this.defaultPartialBlockTemplate;
			} else {
				if (!this.isRegistered) {
					this.blockPresetsInfo.prior.templateName = this.defaultAnonBlockTemplate;
				} else {
					this.blockPresetsInfo.prior.templateName = isInfinity(this.currentBlockInfo.expiry)
						? this.defaultIndefBlockTemplate
						: this.defaultBlockTemplate;
				}
			}
		} else {
			// But first remove any prior prior
			blockGroup = blockGroup.filter((bg) => bg.label !== prior.label);
		}

		// Can be in preset or template field, so the old one in the template
		// field will linger. No need to keep the old value around, so just
		// remove it; saves trouble when hiding/evaluating
		// $form.find("[name=dstopic]").parent().remove();

		this.saveFieldset($('[name=field_block_options]'));
		this.saveFieldset($('[name=field_template_options]'));

		if (input.block) {
			field_preset = new Morebits.quickForm.element({ type: 'field', label: 'Preset', name: 'field_preset' });
			field_preset.append({
				type: 'select',
				name: 'preset',
				label: msg('choose-preset'),
				event: this.change_preset.bind(this),
				list: this.filtered_block_groups(blockGroup),
			});

			field_block_options = new Morebits.quickForm.element({
				type: 'field',
				label: msg('block-block-options'),
				name: 'field_block_options',
			});
			field_block_options.append({ type: 'div', name: 'currentblock', label: ' ' });
			field_block_options.append({ type: 'div', name: 'hasblocklog', label: ' ' });
			field_block_options.append({
				type: 'select',
				name: 'expiry_preset',
				label: msg('block-expiry'),
				event: this.change_expiry.bind(this),
				list: [
					{ label: msg('block-custom-expiry'), value: 'custom', selected: true },
					{ label: msg('block-expiry-indefinite'), value: 'infinity' },
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
				label: msg('block-custom-expiry'),
				tooltip: msg('block-custom-expiry-tooltip'),
				value: this.field_block_options.expiry || this.field_template_options.template_expiry,
			});

			if (input.partial) {
				// Partial block
				field_block_options.append({
					type: 'select',
					multiple: true,
					name: 'pagerestrictions',
					label: msg('block-pages-label'),
					value: '',
					tooltip: msg('block-pages-tooltip'),
				});
				field_block_options.append({
					type: 'select',
					multiple: true,
					name: 'namespacerestrictions',
					label: msg('block-namespaces-label'),
					value: '',
					tooltip: msg('block-namespaces-tooltip'),
					list: obj_entries(this.menuFormattedNamespaces)
						.filter(([nsNumber]) => {
							// @ts-ignore // screw it, nsNumber is number, not string
							return nsNumber >= 0 && !this.disablePartialBlockNamespaces.includes(nsNumber);
						})
						.map(([nsNumber, nsName]) => {
							return { type: 'option', label: nsName, value: nsNumber };
						}),
				});
			}

			field_block_options.append({
				type: 'checkbox',
				name: 'blockoptions',
				list: [
					{
						checked: this.field_block_options.nocreate,
						label: msg('block-nocreate-label'),
						name: 'nocreate',
						value: '1',
					},
					{
						checked: this.field_block_options.noemail,
						label: msg('block-noemail-label'),
						name: 'noemail',
						value: '1',
					},
					{
						checked: this.field_block_options.disabletalk,
						label: msg('block-disabletalk-label'),
						name: 'disabletalk',
						value: '1',
						tooltip: input.partial ? msg('block-partial-disabletalk-tooltip') : '',
					},
					this.isRegistered
						? {
								checked: this.field_block_options.autoblock,
								label: msg('block-auto-label'),
								name: 'autoblock',
								value: '1',
						  }
						: {
								checked: this.field_block_options.hardblock,
								label: msg('block-hard-label'),
								name: 'hardblock',
								value: '1',
						  },
					{
						checked: this.field_block_options.watchuser,
						label: msg('block-watch-label'),
						name: 'watchuser',
						value: '1',
					},
				] as quickFormElementData[],
			});

			field_block_options.append({
				type: 'textarea',
				label: msg('block-reason-label'),
				name: 'reason',
				tooltip: msg('block-reason-tooltip'),
				value: this.field_block_options.reason,
			});

			field_block_options.append({
				type: 'div',
				name: 'filerlog_label',
				label: msg('block-see-label'),
				style: 'display:inline-block;font-style:normal !important',
				tooltip: msg('block-see-tooltip'),
			});
			field_block_options.append({
				type: 'checkbox',
				event: this.toggle_see_alsos.bind(this),
				style: 'display:inline-block; margin-right:5px',
				list: [
					{
						label: msg('block-see-filter'),
						name: 'filter_see_also',
						value: 'filter log',
					},
				],
			});
			field_block_options.append({
				type: 'checkbox',
				event: this.toggle_see_alsos.bind(this),
				style: 'display:inline-block',
				list: [
					{
						label: msg('block-see-deleted'),
						name: 'deleted_see_also',
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
		// var dsSelectSettings = {
		// 	type: "select",
		// 	name: "dstopic",
		// 	label: "DS topic",
		// 	value: "",
		// 	tooltip: "If selected, it will inform the template and may be added to the blocking message",
		// 	event: this.toggle_ds_reason,
		// 	list: $.map(this.dsinfo, (info, label) => {
		// 		return { label: label, value: info.code };
		// 	}),
		// };

		if (input.tag) {
			field_template_options = new Morebits.quickForm.element({
				type: 'field',
				label: msg('block-tag-options'),
				name: 'field_template_options',
			});
			field_template_options.append({
				type: 'select',
				name: 'template',
				label: msg('block-tag-template'),
				event: this.change_template.bind(this),
				list: this.filtered_block_groups(blockGroup, true),
				value: this.field_template_options.template,
			});

			// Only visible for aeblock and aepblock, toggled in change_template
			// field_template_options.append(dsSelectSettings);

			field_template_options.append({
				type: 'input',
				name: 'article',
				label: msg('block-linked-label'),
				value: '',
				tooltip: msg('block-linked-tooltip'),
			});

			// Only visible if partial and not blocking
			field_template_options.append({
				type: 'input',
				name: 'area',
				label: msg('block-partial-area-label'),
				value: '',
				tooltip: msg('block-partial-area-tooltip'),
			});

			if (!input.block) {
				field_template_options.append({
					type: 'input',
					name: 'template_expiry',
					label: msg('block-tag-expiry'),
					value: '',
					tooltip: msg('block-tag-expiry-tooltip'),
				});
			}
			field_template_options.append({
				type: 'input',
				name: 'block_reason',
				label: msg('block-tag-reason-label'),
				tooltip: msg('block-tag-reason-tooltip'),
				value: this.field_template_options.block_reason,
			});

			if (input.block) {
				field_template_options.append({
					type: 'checkbox',
					name: 'blank_duration',
					list: [
						{
							label: msg('block-tag-noexpiry-label'),
							checked: this.field_template_options.blank_duration,
							tooltip: msg('block-tag-noexpiry-tooltip'),
						},
					],
				});
			} else {
				field_template_options.append({
					type: 'checkbox',
					list: [
						{
							label: msg('block-tag-notalk-label'),
							name: 'notalk',
							checked: this.field_template_options.notalk,
							tooltip: msg('block-tag-notalk-tooltip'),
						},
						{
							label: msg('block-tag-noemail-label'),
							name: 'noemail_template',
							checked: this.field_template_options.noemail_template,
							tooltip: msg('block-tag-noemail-tooltip'),
						},
						{
							label: msg('block-tag-nocreate-label'),
							name: 'nocreate_template',
							checked: this.field_template_options.nocreate_template,
							tooltip: msg('block-tag-nocreate-tooltip'),
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
			// field_preset.append(dsSelectSettings);
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
				placeholder: msg('block-pages-placeholder'),
				language: {
					errorLoading: () => {
						return msg('select2-badsearch');
					},
				},
				maximumSelectionLength: 10, // Software limitation [[phab:T202776]]
				minimumInputLength: 1, // prevent ajax call when empty
				ajax: {
					url: mw.util.wikiScript('api'),
					dataType: 'json',
					delay: 100,
					data: (params) => {
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
					processResults: (data) => {
						return {
							results: data.query.allpages.map((page) => {
								var title = mw.Title.newFromText(page.title, page.ns).toText();
								return {
									id: title,
									text: title,
								};
							}),
						};
					},
				},
				templateSelection: (choice) => {
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
				placeholder: msg('block-namespaces-placeholder'),
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

			let isPartial = this.currentBlockInfo.partial;
			let isRange = this.currentBlockInfo.rangestart !== this.currentBlockInfo.rangeend;
			let isIndefinite = this.currentBlockInfo.expiry === 'infinity';

			let blockLink = mw.util.getUrl('Special:Log', {
				page: this.blockedUserName,
				type: 'block',
			});
			let status = '';
			if (isPartial) {
				if (isRange) {
					if (sameUser) {
						status = msg('block-current-partial-range', this.relevantUserName);
					} else {
						let cidr = this.blockedUserName.match(/\/(\d{1,3})$/)[1];
						status = msg(
							'block-current-partial-in-range',
							this.relevantUserName,
							cidr,
							`<a target="_blank" href="${blockLink}">${this.blockedUserName}</a>`
						);
					}
				} else {
					status = msg('block-current-partial', this.relevantUserName);
				}
			} else {
				status = msg('block-current', this.relevantUserName);
				if (isRange) {
					if (sameUser) {
						status = msg('block-current-range', this.relevantUserName);
					} else {
						let cidr = this.blockedUserName.match(/\/(\d{1,3})$/)[1];
						status = msg(
							'block-current-in-range',
							this.relevantUserName,
							cidr,
							`<a target="_blank" href="${blockLink}">${this.blockedUserName}</a>`
						);
					}
				}
			}

			status +=
				msg('word-separator') +
				msg(
					'parentheses',
					isIndefinite
						? msg('block-expiry-indefinite')
						: new Morebits.date(this.currentBlockInfo.expiry).isValid()
						? msg('block-expiry-date', this.currentBlockInfo.expiry)
						: ''
				);

			let info = '';
			if (sameUser) {
				info = msg('block-current-change');
			} else {
				info = msg('block-current-add');
			}

			Morebits.status.warn(status, info);

			// Default to the current block conditions on initial form generation
			this.update_form(e, this.currentBlockInfo);
		}

		// This is where T146628 really comes into play: a rangeblock will
		// only return the correct block log if wgRelevantUserName is the
		// exact range, not merely a functional equivalent
		if (this.hasBlockLog) {
			var blockLogLink = [];
			blockLogLink.push(
				link(msg('blocklogpage'), 'Special:Log', {
					page: this.relevantUserName,
					type: 'block',
				})
			);
			if (!this.currentBlockInfo) {
				if (this.lastBlockLogEntry.action === 'unblock') {
					blockLogLink.push(
						msg('word-separator'),
						msg('parentheses', msg('unblocked-ago', this.lastBlockLogEntry.timestamp))
					);
				} else {
					// block or reblock
					blockLogLink.push(
						msg('word-separator'),
						msg(
							'parentheses',
							msg('block-expired', this.lastBlockLogEntry.params.duration, this.lastBlockLogEntry.timestamp)
						)
					);
				}
			}

			Morebits.status.init($('div[name="hasblocklog"] span').last()[0]);
			Morebits.status.warn(this.currentBlockInfo ? msg('block-log-current') : msg('block-log-past'), blockLogLink);
		}

		// Make sure all the fields are correct based on initial defaults
		if (input.block) {
			this.change_preset(e);
		} else if (input.tag) {
			this.change_template(e);
		}
	}

	/**
	 * Default expiry for IP blocks. This value must be present in the select menu.
	 */
	ipBlockExpiryDefault = '31 hours';

	transformBlockPresets() {
		// supply sensible defaults
		$.each(this.blockPresetsInfo, (preset, settings) => {
			settings.summary = settings.summary || settings.reason;
			settings.sig = settings.sig !== undefined ? settings.sig : 'yes';
			settings.indefinite = settings.indefinite || isInfinity(settings.expiry);

			if (!this.isRegistered && settings.indefinite) {
				settings.expiry = this.ipBlockExpiryDefault;
			} else {
				settings.expiry = settings.expiry || this.ipBlockExpiryDefault;
			}

			this.blockPresetsInfo[preset] = settings;
		});
	}

	filtered_block_groups(group, show_template?) {
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
					default:
						break;
				}

				var blockSettings = this.blockPresetsInfo[blockPreset.value];
				if (
					(blockSettings.requireGroup && !Morebits.userIsInGroup(blockSettings.requireGroup)) ||
					(blockSettings.forRegisteredOnly && !this.isRegistered) ||
					(blockSettings.forAnonOnly && this.isRegistered)
				) {
					return;
				}
				if (!show_template || !blockSettings.templateName) {
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
			// Morebits.quickForm.setElementVisibility(form.dstopic.parentNode, key === "uw-aeblock" || key ===
			// "uw-aepblock");
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
			.each((i, el: HTMLInputElement) => {
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
					var pages = data.restrictions.pages.map((pr) => {
						return pr.title;
					});
					// since page restrictions use an ajax source, we
					// short-circuit that and just add a new option
					pages.forEach((page) => {
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
			settings = this.blockPresetsInfo[value],
			input = Morebits.quickForm.getInputData(form) as {
				block: boolean;
				partial: boolean;
				tag: boolean;
			};

		// Block form is not present
		if (!input.block) {
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
			Morebits.quickForm.setElementVisibility(form.noemail_template.parentNode, input.partial);
			Morebits.quickForm.setElementVisibility(form.nocreate_template.parentNode, input.partial);
		} else if (input.tag) {
			// Only present if block && template forms both visible
			Morebits.quickForm.setElementVisibility(
				form.blank_duration.parentNode,
				!settings.indefinite && !settings.nonstandard
			);
		}

		// Morebits.quickForm.setElementVisibility(form.dstopic.parentNode, value === "uw-aeblock" || value ===
		// "uw-aepblock");

		// Only particularly relevant if template form is present
		Morebits.quickForm.setElementVisibility(form.article.parentNode, settings && !!settings.pageParam);
		Morebits.quickForm.setElementVisibility(form.block_reason.parentNode, settings && !!settings.reasonParam);

		// Partial block
		Morebits.quickForm.setElementVisibility(form.area.parentNode, input.partial && !input.block);

		form.root.previewer.closePreview();
	}

	prev_template_expiry = null;

	preview(form: HTMLFormElement) {
		let params = Morebits.quickForm.getInputData(form) as {
			article: string;
			blank_duration: boolean;
			disabletalk: boolean;
			notalk?: boolean;
			indefinite: boolean;
			reason: string;
			template: string;
			dstopic: string;
			partial: boolean;
			pagerestrictions: string[];
			namespacerestrictions: string[];
			noemail: boolean;
			nocreate: boolean;
			area: string;
		};
		params.disabletalk = params.disabletalk || params.notalk;

		var templateText = this.getBlockNoticeWikitextAndSummary(params)[0];

		form.previewer.beginRender(templateText, 'User_talk:' + this.relevantUserName); // Force wikitext/correct
		// username
	}

	evaluate(e) {
		var form = e.target,
			$form = $(e.target),
			toBlock = form.block.checked,
			toWarn = form.tag.checked,
			toPartial = $(form.partial).is(':checked'),
			blockoptions: ApiBlockParams = {},
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
					return alert(msg('block-warn-partial-usertalk'));
				}
				if (!blockoptions.namespacerestrictions && !blockoptions.pagerestrictions) {
					if (!blockoptions.noemail && !blockoptions.nocreate) {
						// Blank entries technically allowed [[phab:T208645]]
						return alert(msg('block-partial-blank'));
					} else if (
						// XXX: i18n
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
				return alert(msg('block-warn-noexpiry'));
			} else if (isInfinity(blockoptions.expiry) && !this.isRegistered) {
				return alert(msg('block-warn-indef-ip'));
			}
			if (!blockoptions.reason) {
				return alert('block-warn-noreason');
			}

			Morebits.simpleWindow.setButtonsEnabled(false);
			Morebits.status.init(e.target);

			// Message doesn't resolve???
			var user = new Morebits.wiki.user(this.relevantUserName, msg('block-doing'));
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
				user.setExpiry(blockoptions.expiry);
				user.setWatchuser(blockoptions.watchuser);
				user.setReason(blockoptions.reason);
				user.setPartial(blockoptions.partial);
				user.setAllowusertalk(blockoptions.allowusertalk);
				user.setAnononly(blockoptions.anononly);
				user.setAutoblock(blockoptions.autoblock);
				user.setNocreate(blockoptions.nocreate);
				user.setNoemail(blockoptions.noemail);
				user.setReblock(blockoptions.reblock);

				if (blockoptions.partial) {
					if (blockoptions.pagerestrictions) {
						user.setPartialPages(blockoptions.pagerestrictions);
					}
					if (blockoptions.namespacerestrictions) {
						user.setPartialNamespaces(blockoptions.namespacerestrictions);
					}
				}

				var blockInfo = user.getBlockInfo();
				var lastLogEntry = user.getLastBlockLogEntry();
				var logid = lastLogEntry?.logid;

				if (logid !== this.lastBlockLogId || !!blockInfo !== !!this.currentBlockInfo) {
					let message = msg('block-conflict', user.getUserName());
					if (lastLogEntry.action === 'block' || lastLogEntry.action === 'reblock') {
						message += msg('block-conflict-block', lastLogEntry.user, lastLogEntry.comment, lastLogEntry.params.expiry);
					} else if (lastLogEntry.action === 'unblock') {
						message += msg(
							'block-conflict-unblock',
							lastLogEntry.user,
							lastLogEntry.comment,
							lastLogEntry.params.expiry
						);
					}

					if (!confirm(message)) {
						Morebits.status.info(msg('block-doing'), msg('user-aborted'));
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
			return alert(msg('block-noop'));
		}
	}

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
		Morebits.wiki.actionCompleted.notice = msg('block-complete');

		var wikipedia_page = new Morebits.wiki.page(userTalkPage, msg('block-tagging-status'));
		wikipedia_page.setCallbackParameters(params);
		wikipedia_page.load((pageobj) => this.main(pageobj));
	}

	/**
	 * Returns an array with:
	 * 1st element: the block notice wikitext, and
	 * 2nd element: edit summary used when posting it.
	 * @param params
	 * @returns [string, string]
	 */
	// XXX: provide some default implementation
	abstract getBlockNoticeWikitextAndSummary(params): [string, string];

	main(pageobj) {
		var params = pageobj.getCallbackParameters(),
			date = new Morebits.date(pageobj.getLoadTime()),
			text;

		params.indefinite = isInfinity(params.expiry);

		if (params.indefinite && getPref('blankTalkpageOnIndefBlock') && params.template !== 'uw-lblock') {
			Morebits.status.info(msg('info'), msg('block-blank-talk'));
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
				Morebits.status.info(msg('info'), msg('block-new-section'));
				text += date.monthHeader() + '\n';
			}
		}

		params.expiry = typeof params.template_expiry !== 'undefined' ? params.template_expiry : params.expiry;

		let [noticetext, summary] = this.getBlockNoticeWikitextAndSummary(params);
		text += noticetext;

		pageobj.setPageText(text);
		pageobj.setEditSummary(summary);
		pageobj.setChangeTags(Twinkle.changeTags);
		pageobj.setWatchlist(getPref('watchWarnings'));
		pageobj.save();
	}
}
