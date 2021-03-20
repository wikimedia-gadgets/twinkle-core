import { Twinkle } from '../twinkle';
import { Dialog } from '../Dialog';
import { makeTemplate, obj_entries, str_startsWith } from '../utils';
import { msg } from '../messenger';
import { Page } from '../Page';
import { NS_USER_TALK } from '../namespaces';
import { TwinkleModule } from '../twinkleModule';
import { getPref } from '../Config';

export interface warning {
	// name of the template to be substituted
	template?: string;

	// brief description shown in the select menu
	label: string;

	// edit summary used when placing the template
	summary: string;

	suppressArticleInSummary?: boolean;

	inputConfig: quickFormElementData;
}

export interface warningLevel {
	label: string;
	list: warning[] | Record<string, warning[]>;
}

export abstract class WarnCore extends TwinkleModule {
	static moduleName = 'Warn';
	moduleName = 'Warn';

	dialog: Dialog;
	warnings: Record<string, warningLevel>;

	portletName = 'Warn';
	portletId = 'twinkle-warn';
	portletTooltip = 'Warn/notify user';
	windowTitle = 'Warn/notify user';

	constructor() {
		super();

		if (mw.config.exists('wgRelevantUserName') && !Morebits.ip.isRange(mw.config.get('wgRelevantUserName'))) {
			this.addMenu();
		}

		if (
			getPref('autoMenuAfterRollback') &&
			mw.config.get('wgNamespaceNumber') === 3 &&
			mw.util.getParamValue('vanarticle') &&
			!mw.util.getParamValue('friendlywelcome') &&
			!mw.util.getParamValue('noautowarn')
		) {
			this.makeWindow();
		}

		// Modify URL of talk page on rollback success pages, makes use of a
		// custom message box in [[MediaWiki:Rollback-success]]
		if (mw.config.get('wgAction') === 'rollback') {
			var $vandalTalkLink = $('#mw-rollback-success').find('.mw-usertoollinks a').first();
			if ($vandalTalkLink.length) {
				$vandalTalkLink.css('font-weight', 'bold');
				$vandalTalkLink.wrapInner(
					$('<span/>').attr(
						'title',
						'If appropriate, you can use Twinkle to warn the user about their edits to this page.'
					)
				);

				// Can't provide vanarticlerevid as only wgCurRevisionId is provided
				var extraParam = 'vanarticle=' + mw.util.rawurlencode(Morebits.pageNameNorm);
				var href = $vandalTalkLink.attr('href');
				if (href.indexOf('?') === -1) {
					$vandalTalkLink.attr('href', href + '?' + extraParam);
				} else {
					$vandalTalkLink.attr('href', href + '&' + extraParam);
				}
			}
		}
	}

	footerlinks = {
		'Choosing a warning level': 'WP:UWUL#Levels',
		'Warn prefs': 'WP:TW/PREF#warn',
		'Twinkle help': 'WP:TW/DOC#warn',
		'Give feedback': 'WT:TW',
	};

	makeWindow() {
		super.makeWindow();
		if (
			mw.config.get('wgRelevantUserName') === mw.config.get('wgUserName') &&
			!confirm('You are about to warn yourself! Are you sure you want to proceed?')
		) {
			return;
		}

		let dialog = (this.dialog = new Dialog(600, 440));
		dialog.setTitle(this.windowTitle);
		dialog.setFooterLinks(this.footerlinks);

		let form = new Morebits.quickForm((e) => this.evaluate(e));
		let main_select = form.append({
			type: 'field',
			label: 'Choose type of warning/notice to issue',
			tooltip: 'First choose a main warning group, then the specific warning to issue.',
		});

		let main_group = main_select.append({
			type: 'select',
			name: 'main_group',
			tooltip: 'You can customize the default selection in your Twinkle preferences',
			event: this.onCategoryChange.bind(this),
			list: this.getWarningGroups(),
		});

		// Will be empty to begin with.
		main_select.append({
			type: 'select',
			name: 'sub_group',
			event: this.changeSubcategory.bind(this),
		});

		form.append({
			type: 'div',
			id: 'twinkle-warn-input',
		});

		// A place for notices, to be populated by populateNotices()
		form.append({
			type: 'div',
			label: '',
			style: 'color: red',
			id: 'twinkle-warn-warning-messages',
		});

		var more = form.append({ type: 'field', name: 'reasonGroup', label: 'Warning information' });
		more.append({
			type: 'textarea',
			label: 'Optional message:',
			name: 'reason',
			tooltip: 'Perhaps a reason, or that a more detailed notice must be appended',
		});

		var previewlink = document.createElement('a');
		$(previewlink).click(() => {
			this.preview(result); // |result| is defined below
		});
		previewlink.style.cursor = 'pointer';
		previewlink.textContent = 'Preview';
		more.append({ type: 'div', id: 'warningpreview', label: [previewlink] });
		more.append({ type: 'div', id: 'twinklewarn-previewbox', style: 'display: none' });

		more.append({ type: 'submit', label: 'Submit' });

		var result = form.render();
		dialog.setContent(result);
		dialog.display();
		result.main_group.root = result;
		result.previewer = new Morebits.wiki.preview($(result).find('div#twinklewarn-previewbox').last()[0]);

		this.populateNotices();

		this.processWarnings();

		// We must init the first choice (General Note);
		var evt = document.createEvent('Event');
		evt.initEvent('change', true, true);
		result.main_group.dispatchEvent(evt);
	}

	/**
	 * Populate #twinkle-warn-warning-messages with any notices for the tool operator, such as
	 * for staleness and missed reverts
	 */
	populateNotices() {
		var vanrevid = mw.util.getParamValue('vanarticlerevid');
		if (vanrevid) {
			var message = '';
			var query = {};

			// If you tried reverting, check if *you* actually reverted
			if (!mw.util.getParamValue('noautowarn') && mw.util.getParamValue('vanarticle')) {
				// Via fluff link
				query = {
					action: 'query',
					titles: mw.util.getParamValue('vanarticle'),
					prop: 'revisions',
					rvstartid: vanrevid,
					rvlimit: 2,
					rvdir: 'newer',
					rvprop: 'user',
					format: 'json',
				};

				new Morebits.wiki.api('Checking if you successfully reverted the page', query, function (apiobj) {
					var rev = apiobj.getResponse().query.pages[0].revisions;
					var revertUser = rev && rev[1].user;
					if (revertUser && revertUser !== mw.config.get('wgUserName')) {
						message += ' Someone else reverted the page and may have already warned the user.';
						$('#twinkle-warn-warning-messages').text('Note:' + message);
					}
				}).post();
			}

			// Confirm edit wasn't too old for a warning
			var checkStale = function (vantimestamp) {
				var revDate = new Morebits.date(vantimestamp);
				if (vantimestamp && revDate.isValid()) {
					if (revDate.add(24, 'hours').isBefore(new Date())) {
						message += ' This edit was made more than 24 hours ago so a warning may be stale.';
						$('#twinkle-warn-warning-messages').text('Note:' + message);
					}
				}
			};

			var vantimestamp = mw.util.getParamValue('vantimestamp');
			// Provided from a fluff module-based revert, no API lookup necessary
			if (vantimestamp) {
				checkStale(vantimestamp);
			} else {
				query = {
					action: 'query',
					prop: 'revisions',
					rvprop: 'timestamp',
					revids: vanrevid,
					format: 'json',
				};
				new Morebits.wiki.api('Grabbing the revision timestamps', query, function (apiobj) {
					var rev = apiobj.getResponse().query.pages[0].revisions;
					vantimestamp = rev && rev[0].timestamp;
					checkStale(vantimestamp);
				}).post();
			}
		}
	}

	abstract warningLevels: Record<
		string,
		{ label: string; selected: (pref: number) => boolean; visible?: () => boolean }
	>;

	getWarningGroups(): Array<quickFormElementData> {
		const defaultGroupPref = parseInt(getPref('defaultWarningGroup'), 10);
		return obj_entries(this.warningLevels)
			.filter(([value, config]) => {
				// if config.visible function is not defined, level should be visible,
				// if it is defined, level should be visible only if the function returns true
				return !config.visible || config.visible();
			})
			.map(([value, config]) => {
				return {
					type: 'option',
					value: value,
					label: config.label,
					selected: config.selected(defaultGroupPref),
				};
			});
	}

	/**
	 * This function should define this.warnings
	 */
	abstract processWarnings();

	getWarningsInLevel(newlevel: string) {
		let list;

		if (newlevel === 'custom') {
			list = getPref('customWarningList').map((item) => ({
				label: '{{' + item.value + '}}: ' + item.label,
				value: item.value,
				$data: item,
			}));
		} else if (newlevel === 'kitchensink') {
			list = [];
			for (let [level, warningList] of obj_entries(this.warnings)) {
				if (Array.isArray(warningList.list)) {
					// make list of options
					list.push({
						label: warningList.label,
						list: warningList.list.map((item) => ({
							label: '{{' + item.template + '}}: ' + item.label,
							value: item.template,
							$data: item,
						})),
					});
				} else {
					list = list.concat(
						obj_entries(warningList.list).map(([label, items]) => ({
							label: warningList.label + msg('colon-separator') + label,
							list: items.map((item) => ({
								label: '{{' + item.template + '}}: ' + item.label,
								value: item.template,
								$data: item,
							})),
						}))
					);
				}
			}
			list.push({
				label: 'Custom warnings',
				list: getPref('customWarningList').map((item) => ({
					label: '{{' + item.value + '}}: ' + item.label,
					value: item.value,
					$data: item,
				})),
			});
		} else {
			const warningList = this.warnings[newlevel].list;
			if (Array.isArray(warningList)) {
				list = warningList.map((item) => ({
					label: '{{' + item.template + '}}: ' + item.label,
					value: item.template,
					$data: item,
				}));
			} else {
				list = obj_entries(warningList).map(([label, items]) => ({
					label: label,
					list: items.map((item) => ({
						label: '{{' + item.template + '}}: ' + item.label,
						value: item.template,
						$data: item,
					})),
				}));
			}
		}

		return {
			type: 'select',
			name: 'sub_group',
			event: this.changeSubcategory.bind(this),
			list,
		} as quickFormElementData;
	}

	onCategoryChange(e) {
		let newlevel = e.target.value as string;
		let tSelect = e.target.form.sub_group;

		let rgx = this.getTemplateMatchRegex(tSelect.value, newlevel);

		let newSelect = new Morebits.quickForm.element(this.getWarningsInLevel(newlevel)).render();
		$(tSelect).parent().replaceWith(newSelect);

		if (rgx) {
			$(newSelect)
				.find('option')
				.each((_, option) => {
					if (rgx.test(option.value)) {
						option.selected = true;
						return false; // break
					}
				});
		}

		$('#twinkle-warn-autolevel-message').remove();
		this.postCategoryCleanup(e);
	}

	getTemplateMatchRegex(template: string, newlevel: string): RegExp | undefined {
		if (newlevel === 'kitchensink') {
			return new RegExp(mw.util.escapeRegExp(template));
		} else if (str_startsWith(newlevel, 'level')) {
			return new RegExp(mw.util.escapeRegExp(template.replace(/\d(im)?$/, '')) + '(\\d(?:im)?)$');
		}
	}

	postCategoryCleanup(e) {
		this.changeSubcategory(e);

		// Use select2 to make the select menu searchable
		if (!getPref('oldSelect')) {
			$(e.target.form.sub_group)
				.select2({
					width: '100%',
					matcher: Morebits.select2.matchers.optgroupFull,
					templateResult: Morebits.select2.highlightSearchMatches,
					language: {
						searching: Morebits.select2.queryInterceptor,
					},
				})
				.change(this.changeSubcategory.bind(this));

			$('.select2-selection').on('keydown', Morebits.select2.autoStart).trigger('focus');

			mw.util.addCSS(
				// Increase height
				'.select2-container .select2-dropdown .select2-results > .select2-results__options { max-height: 350px; }' +
					// Reduce padding
					'.select2-results .select2-results__option { padding-top: 1px; padding-bottom: 1px; }' +
					'.select2-results .select2-results__group { padding-top: 1px; padding-bottom: 1px; } ' +
					// Adjust font size
					'.select2-container .select2-dropdown .select2-results { font-size: 13px; }' +
					'.select2-container .selection .select2-selection__rendered { font-size: 13px; }'
			);
		}
	}

	getInputConfig(template: string): quickFormElementData {
		return {
			label: 'Linked page',
			value: mw.util.getParamValue('vanarticle') || '',
			tooltip:
				'A page can be linked within the notice, perhaps because it was a revert to said page that dispatched this notice. Leave empty for no page to be linked.',
			className: 'titleInput',
		};
	}

	changeSubcategory(e) {
		let value = e.target.form.sub_group.value;

		$('#twinkle-warn-input')
			.empty()
			.append(
				new Morebits.quickForm.element(
					$.extend(this.getInputConfig(value), {
						type: 'input',
						name: 'article',
					})
				).render()
			);

		// add big red notice, warning users about how to use {{uw-[coi-]username}} appropriately
		$('#tw-warn-red-notice').remove();
		$(this.perWarningNotices(value)).insertAfter(Morebits.quickForm.getElementLabelObject(e.target.form.reasonGroup));
	}

	/**
	 * Add some notices for the Twinkle user when they select specific templates to use
	 */
	perWarningNotices(template): JQuery {
		switch (template) {
			case 'uw-username':
				return $(
					"<div style='color: red;' id='tw-warn-red-notice'>{{uw-username}} should <b>not</b> be used for <b>blatant</b> username policy violations. " +
						"Blatant violations should be reported directly to UAA (via Twinkle's ARV tab). " +
						'{{uw-username}} should only be used in edge cases in order to engage in discussion with the user.</div>'
				);
			case 'uw-coi-username':
				return $(
					"<div style='color: red;' id='tw-warn-red-notice'>{{uw-coi-username}} should <b>not</b> be used for <b>blatant</b> username policy violations. " +
						"Blatant violations should be reported directly to UAA (via Twinkle's ARV tab). " +
						'{{uw-coi-username}} should only be used in edge cases in order to engage in discussion with the user.</div>'
				);
			default:
				return $();
		}
	}

	getWarningWikitext(templateName, article, reason, isCustom) {
		let text = makeTemplate('subst:' + templateName, {
			1: article,
			2: reason && !isCustom ? reason : null,
		});
		if (isCustom && reason) {
			// we assume that custom warnings lack a {{{2}}} parameter
			text += " ''" + reason + "''";
		}
		return text + ' ~~~~';
	}

	showPreview(form: HTMLFormElement, templatename?: string) {
		var input = Morebits.quickForm.getInputData(form);
		// Provided on autolevel, not otherwise
		templatename = templatename || (input.sub_group as string);
		var templatetext = this.getWarningWikitext(
			templatename,
			input.article,
			input.reason,
			input.main_group === 'custom'
		);

		form.previewer.beginRender(templatetext, 'User_talk:' + mw.config.get('wgRelevantUserName')); // Force wikitext/correct username
	}

	preview(form: HTMLFormElement) {
		this.showPreview(form);
	}

	validateInputs(params: Record<string, any>): string | void {}

	evaluate(e) {
		var userTalkPage = new mw.Title(mw.config.get('wgRelevantUserName'), NS_USER_TALK);

		const params = Morebits.quickForm.getInputData(e.target);
		let validationMessage = this.validateInputs(params);
		if (validationMessage) {
			return alert(validationMessage);
		}

		var $selectedEl = $(e.target.sub_group).find(':selected');
		// @ts-ignore
		params.messageData = $selectedEl.data() as warning;

		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(e.target);

		var wikipedia_page = new Page(userTalkPage.toText(), 'User talk page modification');
		wikipedia_page.setFollowRedirect(true, false);
		wikipedia_page
			.load()
			.then(() => {
				return this.main(wikipedia_page, params);
			})
			.then(() => {
				Morebits.status.actionCompleted('Warning complete, reloading talk page in a few seconds');
				setTimeout(() => {
					location.href = mw.util.getUrl(userTalkPage.toText());
				}, 8000);
			});
	}

	/**
	 * Used to determine when to warn
	 * about excessively recent, stale, or identical warnings.
	 * @param {string} wikitext  The text of a user's talk page, from getPageText()
	 * @returns {Object[]} - Array of objects: latest contains most recent
	 * warning and date; history lists all prior warnings
	 */
	dateProcessing(wikitext: string): [{ date: Morebits.date; type: string }, Record<string, Morebits.date>] {
		var history_re = this.getHistoryRegex();
		var history = {} as Record<string, Morebits.date>;
		var latest = { date: new Morebits.date(0), type: '' };
		if (!history_re) {
			return [latest, history];
		}
		var current;

		while ((current = history_re.exec(wikitext)) !== null) {
			var template = current[1],
				current_date = new Morebits.date(current[2]);
			if (!(template in history) || history[template].isBefore(current_date)) {
				history[template] = current_date;
			}
			if (!latest.date.isAfter(current_date)) {
				latest.date = current_date;
				latest.type = template;
			}
		}
		return [latest, history];
	}

	/**
	 * Return a regex expression with 2 capturing groups:
	 *  1) captures the name of the template (without the namespace prefix)
	 *  2) captures the comment timestamp - it is assumed that this timestamp can be parsed by Morebits.date()
	 */
	getHistoryRegex(): RegExp | void {}

	// build the edit summary
	// Function to handle generation of summary prefix for custom templates
	customTemplateEditSummaryPrefix(template, messageData: warning) {
		// let template = messageData.template;
		template = template.split('|')[0];
		var prefix;
		switch (template.substr(-1)) {
			case '1':
				prefix = 'General note';
				break;
			case '2':
				prefix = 'Caution';
				break;
			case '3':
				prefix = 'Warning';
				break;
			case '4':
				prefix = 'Final warning';
				break;
			case 'm':
				if (template.substr(-3) === '4im') {
					prefix = 'Only warning';
					break;
				}
			// falls through
			default:
				prefix = 'Notice';
				break;
		}
		return prefix + ': ' + Morebits.string.toUpperCaseFirstChar(messageData.label);
	}

	customiseSummaryWithInput(summary: string, input: string, messageData: warning) {
		if (!input || messageData.suppressArticleInSummary !== true) {
			return summary;
		}
		return summary + ' on [[:' + input + ']]';
	}

	main(pageobj: Page, params) {
		var text = pageobj.getPageText();
		var statelem = pageobj.getStatusElement();
		var messageData = params.messageData;

		var [latest, history] = this.dateProcessing(text);

		var now = new Morebits.date(pageobj.getLoadTime());

		if (
			params.sub_group in history &&
			new Morebits.date(history[params.sub_group]).add(1, 'day').isAfter(now) &&
			!confirm(
				'An identical ' +
					params.sub_group +
					' has been issued in the last 24 hours.  \nWould you still like to add this warning/notice?'
			)
		) {
			statelem.error('aborted per user request');
			return;
		}

		latest.date.add(1, 'minute'); // after long debate, one minute is max

		if (
			latest.date.isAfter(now) &&
			!confirm(
				'A ' + latest.type + ' has been issued in the last minute.  \nWould you still like to add this warning/notice?'
			)
		) {
			statelem.error('aborted per user request');
			return;
		}

		var summary;
		if (params.main_group === 'custom') {
			summary = this.customTemplateEditSummaryPrefix(params.sub_group, messageData);
		} else {
			// Normalize kitchensink to the 1-4im style
			if (params.main_group === 'kitchensink' && !/^D+$/.test(params.sub_group)) {
				var sub = params.sub_group.substr(-1);
				if (sub === 'm') {
					sub = params.sub_group.substr(-3);
				}
				// Don't overwrite uw-3rr, technically unnecessary
				if (/\d/.test(sub)) {
					params.main_group = 'level' + sub;
				}
			}
			// singlet || level1-4im, no need to /^\D+$/.test(params.main_group)
			summary = messageData.summary || (messageData[params.main_group] && messageData[params.main_group].summary);
			// Not in Twinkle.warn.messages, assume custom template
			if (!summary) {
				summary = this.customTemplateEditSummaryPrefix(params.sub_group, messageData);
			}
			summary = this.customiseSummaryWithInput(summary, params.article, messageData);
		}

		pageobj.setEditSummary(summary + '.');
		pageobj.setChangeTags(Twinkle.changeTags);
		pageobj.setWatchlist(getPref('watchWarnings'));

		// Get actual warning text
		var warningText = this.getWarningWikitext(
			params.sub_group,
			params.article,
			params.reason,
			params.main_group === 'custom'
		);

		if (getPref('showSharedIPNotice') && mw.util.isIPAddress(mw.config.get('wgTitle'))) {
			Morebits.status.info('Info', 'Adding a shared IP notice');
			warningText += '\n{{subst:Shared IP advice}}';
		}

		var sectionExists = false,
			sectionNumber = 0;
		// Only check sections if there are sections or there's a chance we won't create our own
		if (!messageData.heading && text.length) {
			// Get all sections
			var sections = text.match(/^(==*).+\1/gm);
			if (sections && sections.length !== 0) {
				// Find the index of the section header in question
				var dateHeaderRegex = now.monthHeaderRegex();
				sectionNumber = 0;
				// Find this month's section among L2 sections, preferring the bottom-most
				sectionExists = sections.reverse().some((sec, idx) => {
					return (
						/^(==)[^=].+\1/m.test(sec) &&
						dateHeaderRegex.test(sec) &&
						typeof (sectionNumber = sections.length - 1 - idx) === 'number'
					);
				});
			}
		}

		if (sectionExists) {
			// append to existing section
			pageobj.setPageSection(sectionNumber + 1);
			pageobj.setAppendText('\n\n' + warningText);
			return pageobj.append();
		} else {
			if (messageData.heading) {
				// create new section
				pageobj.setNewSectionTitle(messageData.heading);
			} else {
				Morebits.status.info('Info', 'Will create a new talk page section for this month, as none was found');
				pageobj.setNewSectionTitle(now.monthHeader());
			}
			pageobj.setNewSectionText(warningText);
			return pageobj.newSection();
		}
	}
}
