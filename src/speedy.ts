import { Twinkle, TwinkleModule } from './twinkle';
import { makeArray, obj_entries } from './utils';

// TODO: still quite a bit of enwiki specific logic here

export interface criterion extends quickFormElementData {
	value: string // made compulsory
	code: string
	subgroup?: criteriaSubgroup | criteriaSubgroup[]

	showInNamespaces?: number[]
	hideInNamespaces?: number[]

	// These are booleans, but `true` is used instead of `boolean` because
	// when the value should be false, the prop should be omitted.
	redactContents?: true // used for attack pages
	hideWhenMultiple?: true
	hideWhenSingle?: true
	hideWhenUser?: true
	hideWhenSysop?: true
	hideSubgroupWhenUser?: true
	hideSubgroupWhenSingle?: true
	hideSubgroupWhenMultiple?: true
	hideSubgroupWhenSysop?: true
	hideWhenRedirect?: true
}
export interface criteriaSubgroup extends quickFormElementData {
	parameter?: string
	utparam?: string
	log?: string | null
}

export abstract class Speedy extends TwinkleModule {
	static moduleName = 'CSD';

	dialog: Morebits.simpleWindow;
	form: Morebits.quickForm;
	result: HTMLFormElement;
	hasCSD: boolean;
	flatObject: Record<string, criterion>;
	params: Record<string, any>;
	namespace: number;
	mode: {isSysop: boolean, isMultiple: boolean, isRadioClick: boolean}
	isRedirect: boolean
	abstract criteriaLists: Array<{label: string, visible: ((self: Speedy) => boolean), list: Array<criterion>}>;

	portletName = 'CSD';
	portletId = 'twinkle-csd';
	portletTooltip = Morebits.userIsSysop ? 'Delete page according to WP:CSD' : 'Request speedy deletion according to WP:CSD';

	constructor() {
		super();
		this.addMenu();
	}

	makeWindow() {
		this.dialog = new Morebits.simpleWindow(Twinkle.getPref('speedyWindowWidth'), Twinkle.getPref('speedyWindowHeight'));
		this.dialog.setTitle('Choose criteria for speedy deletion');
		this.dialog.setScriptName(Twinkle.scriptName)
		this.dialog.addFooterLink('Speedy deletion policy', 'WP:CSD');
		this.dialog.addFooterLink('CSD prefs', 'WP:TW/PREF#speedy');
		this.dialog.addFooterLink('Twinkle help', 'WP:TW/DOC#speedy');

		this.hasCSD = !!$('#delete-reason').length;
		this.makeFlatObject();

		let form = new Morebits.quickForm((e) => this.evaluate(e), Twinkle.getPref('speedySelectionStyle') === 'radioClick' ? 'change' : null);
		this.form = form;

		if (Morebits.userIsSysop) {
			form.append({
				type: 'checkbox',
				list: [
					{
						label: 'Tag page only, don\'t delete',
						value: 'tag_only',
						name: 'tag_only',
						tooltip: 'If you just want to tag the page, instead of deleting it now',
						checked: !(this.hasCSD || Twinkle.getPref('deleteSysopDefaultToDelete')),
						event: (event) => {
							let cForm = event.target.form;
							let cChecked = event.target.checked;
							// enable talk page checkbox
							if (cForm.deleteTalkPage) {
								cForm.deleteTalkPage.checked = !cChecked && Twinkle.getPref('deleteTalkPageOnDelete');
							}
							// enable redirects checkbox
							cForm.deleteRedirects.checked = !cChecked;
							// enable delete multiple
							cForm.delmultiple.checked = false;
							// enable notify checkbox
							cForm.notify.checked = cChecked;
							// enable deletion notification checkbox
							cForm.warnusertalk.checked = !cChecked && !this.hasCSD;
							// enable multiple
							cForm.multiple.checked = false;
							// enable requesting creation protection
							cForm.requestsalt.checked = false;

							this.modeChanged(cForm);

							event.stopPropagation();
						}
					}
				]
			});



			let deleteOptions = form.append({
				type: 'div',
				name: 'delete_options'
			});
			deleteOptions.append({
				type: 'header',
				label: 'Delete-related options'
			});
			if (mw.config.get('wgNamespaceNumber') % 2 === 0 && (mw.config.get('wgNamespaceNumber') !== 2 || (/\//).test(mw.config.get('wgTitle')))) {  // hide option for user pages, to avoid accidentally deleting user talk page
				deleteOptions.append({
					type: 'checkbox',
					list: [
						{
							label: 'Also delete talk page',
							value: 'deleteTalkPage',
							name: 'deleteTalkPage',
							tooltip: "This option deletes the page's talk page in addition. If you choose the F8 (moved to Commons) criterion, this option is ignored and the talk page is *not* deleted.",
							checked: Twinkle.getPref('deleteTalkPageOnDelete'),
							event: (event) => event.stopPropagation()
						}
					]
				});
			}
			deleteOptions.append({
				type: 'checkbox',
				list: [
					{
						label: 'Also delete all redirects',
						value: 'deleteRedirects',
						name: 'deleteRedirects',
						tooltip: 'This option deletes all incoming redirects in addition. Avoid this option for procedural (e.g. move/merge) deletions.',
						checked: Twinkle.getPref('deleteRedirectsOnDelete'),
						event: (event) => event.stopPropagation()
					},
					{
						label: 'Delete under multiple criteria',
						value: 'delmultiple',
						name: 'delmultiple',
						tooltip: 'When selected, you can select several criteria that apply to the page. For example, G11 and A7 are a common combination for articles.',
						event: (event) => {
							this.modeChanged(event.target.form);
							event.stopPropagation();
						}
					},
					{
						label: 'Notify page creator of page deletion',
						value: 'warnusertalk',
						name: 'warnusertalk',
						tooltip: 'A notification template will be placed on the talk page of the creator, IF you have a notification enabled in your Twinkle preferences ' +
							'for the criterion you choose AND this box is checked. The creator may be welcomed as well.',
						checked: !this.hasCSD,
						event: (event) => event.stopPropagation()
					}
				]
			});
		}



		let tagOptions = form.append({
			type: 'div',
			name: 'tag_options'
		});

		if (Morebits.userIsSysop) {
			tagOptions.append({
				type: 'header',
				label: 'Tag-related options'
			});
		}

		tagOptions.append({
			type: 'checkbox',
			list: [
				{
					label: 'Notify page creator if possible',
					value: 'notify',
					name: 'notify',
					tooltip: 'A notification template will be placed on the talk page of the creator, IF you have a notification enabled in your Twinkle preferences ' +
						'for the criterion you choose AND this box is checked. The creator may be welcomed as well.',
					checked: !Morebits.userIsSysop || !(this.hasCSD || Twinkle.getPref('deleteSysopDefaultToDelete')),
					event: (event) => event.stopPropagation()
				},
				{
					label: 'Tag for creation protection (salting) as well',
					value: 'requestsalt',
					name: 'requestsalt',
					tooltip: 'When selected, the speedy deletion tag will be accompanied by a {{salt}} tag requesting that the deleting administrator apply creation protection. Only select if this page has been repeatedly recreated.',
					event: (event) => event.stopPropagation()
				},
				{
					label: 'Tag with multiple criteria',
					value: 'multiple',
					name: 'multiple',
					tooltip: 'When selected, you can select several criteria that apply to the page. For example, G11 and A7 are a common combination for articles.',
					event: (event) => {
						this.modeChanged(event.target.form);
						event.stopPropagation();
					}
				}
			]
		});




		form.append({
			type: 'div',
			id: 'prior-deletion-count',
			style: 'font-style: italic'
		});

		form.append({
			type: 'div',
			name: 'work_area',
			label: 'Failed to initialize the CSD module. Please try again, or tell the Twinkle developers about the issue.'
		});

		if (Twinkle.getPref('speedySelectionStyle') !== 'radioClick') {
			form.append({ type: 'submit', className: 'tw-speedy-submit' }); // Renamed in modeChanged
		}

		this.result = form.render();
		this.dialog.setContent(this.result);
		this.dialog.display();

		this.modeChanged(this.result);

		// Check for prior deletions.  Just once, upon init
		this.priorDeletionCount();

	}

	priorDeletionCount() {
		let query = {
			action: 'query',
			format: 'json',
			list: 'logevents',
			letype: 'delete',
			leaction: 'delete/delete', // Just pure page deletion, no redirect overwrites or revdel
			letitle: mw.config.get('wgPageName'),
			leprop: '', // We're just counting we don't actually care about the entries
			lelimit: 5  // A little bit goes a long way
		};

		new Morebits.wiki.api('Checking for past deletions', query, function(apiobj) {
			let response = apiobj.getResponse();
			let delCount = response.query.logevents.length;
			if (delCount) {
				let message = delCount + ' previous deletion';
				if (delCount > 1) {
					message += 's';
					if (response.continue) {
						message = 'More than ' + message;
					}

					// 3+ seems problematic
					if (delCount >= 3) {
						$('#prior-deletion-count').css('color', 'red');
					}
				}

				// Provide a link to page logs (CSD templates have one for sysops)
				let link = Morebits.htmlNode('a', '(logs)');
				link.setAttribute('href', mw.util.getUrl('Special:Log', {page: mw.config.get('wgPageName')}));
				link.setAttribute('target', '_blank');

				$('#prior-deletion-count').text(message + ' '); // Space before log link
				$('#prior-deletion-count').append(link);
			}
		}).post();
	}

	getMode() {
		let form = this.result;
		return this.mode = {
			isSysop: !!form.tag_only && !form.tag_only.checked,
			isMultiple: form.tag_only && !form.tag_only.checked ? form.delmultiple.checked : form.multiple.checked,
			isRadioClick: Twinkle.getPref('speedySelectionStyle') === 'radioClick'
		};
	}

	modeChanged(form: HTMLFormElement) {
		// first figure out what mode we're in
		this.getMode();

		$('[name=delete_options]').toggle(this.mode.isSysop);
		$('[name=tag_options]').toggle(!this.mode.isSysop);
		$('button.tw-speedy-submit').text(this.mode.isSysop ? 'Delete page' : 'Tag page');

		let work_area = new Morebits.quickForm.element({
			type: 'div',
			name: 'work_area'
		});

		if (this.mode.isMultiple && this.mode.isRadioClick) {
			work_area.append({
				type: 'div',
				label: 'When finished choosing criteria, click:'
			});
			work_area.append({
				type: 'button',
				name: 'submit-multiple',
				label: this.mode.isSysop ? 'Delete page' : 'Tag page',
				event: (event) => {
					this.evaluate(event);
					event.stopPropagation();
				}
			});
		}

		this.appendCriteriaLists(work_area);

		$(form).find('[name=work_area]').replaceWith(work_area.render());

		// if sysop, check if CSD is already on the page and fill in custom rationale
		if (this.mode.isSysop && this.hasCSD) {
			let customOption = $('input[name=csd][value=reason]')[0];
			if (customOption) {
				if (Twinkle.getPref('speedySelectionStyle') !== 'radioClick') {
					// force listeners to re-init
					customOption.click();
				}
				let deleteReason = decodeURIComponent($('#delete-reason').text()).replace(/\+/g, ' ');
				$('input[name="csd.reason_1"]').val(deleteReason);
			}
		}
	}

	appendCriteriaLists(work_area: Morebits.quickForm.element) {

		this.namespace = mw.config.get('wgNamespaceNumber');
		this.isRedirect = Morebits.isPageRedirect();

		let inputType = (this.mode.isMultiple ? 'checkbox' : 'radio') as 'radio' | 'checkbox';

		this.criteriaLists.forEach((criteriaList) => {
			if (criteriaList.visible(this)) {
				work_area.append({ type: 'header', label: criteriaList.label });
				work_area.append({ type: inputType, name: 'csd', list: this.generateCsdList(criteriaList.list) });
			}
		});
	}


	generateCsdList(list: Array<criterion>) {
		let mode = this.mode;
		let openSubgroupHandler = (e) => {
			$(e.target.form).find('input').prop('disabled', true);
			$(e.target.form).children().css('color', 'gray');
			$(e.target).parent().css('color', 'black').find('input').prop('disabled', false);
			$(e.target).parent().find('input:text')[0].focus();
			e.stopPropagation();
		};
		let submitSubgroupHandler = (e) => {
			let evaluateType = mode.isSysop ? 'evaluateSysop' : 'evaluateUser';
			this[evaluateType](e);
			e.stopPropagation();
		};

		return list.map((critElement) => {
			let criterion = $.extend({}, critElement);

			if (mode.isMultiple) {
				if (criterion.hideWhenMultiple) {
					return null;
				}
				if (criterion.hideSubgroupWhenMultiple) {
					criterion.subgroup = null;
				}
			} else {
				if (criterion.hideWhenSingle) {
					return null;
				}
				if (criterion.hideSubgroupWhenSingle) {
					criterion.subgroup = null;
				}
			}

			if (mode.isSysop) {
				if (criterion.hideWhenSysop) {
					return null;
				}
				if (criterion.hideSubgroupWhenSysop) {
					criterion.subgroup = null;
				}
			} else {
				if (criterion.hideWhenUser) {
					return null;
				}
				if (criterion.hideSubgroupWhenUser) {
					criterion.subgroup = null;
				}
			}

			if (Morebits.isPageRedirect() && criterion.hideWhenRedirect) {
				return null;
			}

			if (criterion.showInNamespaces && criterion.showInNamespaces.indexOf(this.namespace) < 0) {
				return null;
			}
			if (criterion.hideInNamespaces && criterion.hideInNamespaces.indexOf(this.namespace) > -1) {
				return null;
			}

			if (criterion.subgroup && !mode.isMultiple && mode.isRadioClick) {
				criterion.subgroup = makeArray(criterion.subgroup).concat({
					type: 'button',
					name: 'submit',  // ends up being called "csd.submit" so this is OK
					label: mode.isSysop ? 'Delete page' : 'Tag page',
					event: submitSubgroupHandler
				});
				// FIXME: does this do anything?
				criterion.event = openSubgroupHandler;
			}

			return criterion;
		}).filter(e => e); // don't include items that have been made null
	}

	makeFlatObject() {
		this.flatObject = {};
		this.criteriaLists.forEach((criteria) => {
			criteria.list.forEach((criterion) => {
				this.flatObject[criterion.value] = criterion;
			});
		});
	}


	// UI creation ends here!

	evaluate(e: QuickFormEvent | FormSubmitEvent) {
		if (e.target.type === 'checkbox' || e.target.type === 'text' ||
			e.target.type === 'select') {
			return;
		}
		this.params = Morebits.quickForm.getInputData(this.result);
		if (!this.params.csd || !this.params.csd.length) {
			return alert('Please select a criterion!');
		}
		this.preprocessParams();
		let validationMessage = this.validateInputs();
		if (validationMessage) {
			return alert(validationMessage);
		}

		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(this.result);

		let tm = new Morebits.taskManager(this);
		tm.add(this.fetchCreatorInfo, []);
		if (this.mode.isSysop) {
			// Sysop mode deletion
			tm.add(this.parseDeletionReason, []);
			tm.add(this.deletePage, [this.parseDeletionReason]);
			tm.add(this.deleteTalk, [this.deletePage]);
			tm.add(this.deleteRedirects, [this.deletePage]);
			tm.add(this.noteToCreator, [this.deletePage, this.fetchCreatorInfo]);

		} else {
			// Tagging
			tm.add(this.checkPage, []);
			tm.add(this.tagPage, [this.checkPage]); // checkPage passes pageobj to tagPage
			tm.add(this.patrolPage, [this.checkPage]);
			tm.add(this.noteToCreator, [this.checkPage, this.fetchCreatorInfo]);
			tm.add(this.addToLog, [this.noteToCreator]);
		}

		tm.execute().then(() => {
			Morebits.status.actionCompleted(this.mode.isSysop ? 'Deletion completed' : 'Tagging completed');
			setTimeout(() => {
				window.location.href = mw.util.getUrl(Morebits.pageNameNorm);
			}, 50000);
		});
	}

	preprocessParams() {
		let params = this.params;
		params.csd = makeArray(params.csd);
		params.normalizeds = params.csd.map((critValue) => {
			return this.flatObject[critValue].code;
		});
		this.getTemplateParameters();
		this.getMode(); // likely not needed

		if (this.mode.isSysop) {
			params.promptForSummary = params.normalizeds.some((norm) => {
				return Twinkle.getPref('promptForSpeedyDeletionSummary').indexOf(norm) !== -1;
			});
			params.warnUser = params.warnusertalk && params.normalizeds.some((norm, index) => {
				return Twinkle.getPref('warnUserOnSpeedyDelete').indexOf(norm) !== -1 &&
					!(norm === 'g6' && params.values[index] !== 'copypaste');
			});
		} else {
			params.notifyUser = params.notify && params.normalizeds.some(function(norm, index) {
				return Twinkle.getPref('notifyUserOnSpeedyDeletionNomination').indexOf(norm) !== -1 &&
					!(norm === 'g6' && params.csd[index] !== 'copypaste');
			});
			params.redactContents = params.csd.some((csd) => {
				return this.flatObject[csd].redactContents;
			});
		}
		params.watch = params.normalizeds.some(function(norm) {
			return Twinkle.getPref('watchSpeedyPages').indexOf(norm) !== -1 && Twinkle.getPref('watchSpeedyExpiry');
		});
		params.welcomeuser = (params.notifyUser || params.warnUser) && params.normalizeds.some((norm) => {
			return Twinkle.getPref('welcomeUserOnSpeedyDeletionNotification').indexOf(norm) !== -1;
		});

		this.preprocessParamInputs();
	}

	preprocessParamInputs() {}

	/**
	 * Creates this.params.templateParams, an array of objects each object
	 * representing the template parameters for a criterion.
	 */
	getTemplateParameters() {
		this.params.templateParams = new Array(this.params.csd.length) as Array<Record<string, string>>;

		this.params.csd.forEach((value, idx) => {
			let crit = this.flatObject[value];
			let params: Record<string, string> = {};
			makeArray(crit.subgroup).forEach((subgroup) => {
				if (subgroup.parameter && this.params[subgroup.name]) {
					params[subgroup.parameter] = this.params[subgroup.name];
				}
			});
			this.params.templateParams[idx] = params;
		});
	}

	/**
	 * Gets wikitext of the tag to be added to the page being nominated.
	 * @returns {string}
	 */
	getTaggingCode() {
		let params = this.params;
		let code = '';

		if (params.normalizeds.length > 1) {
			code = '{{db-multiple';
			params.normalizeds.forEach((norm, idx) => {
				code += '|' + norm.toUpperCase();
				obj_entries(params.templateParams[idx]).forEach(([param, value]) => {
					// skip numeric parameters - {{db-multiple}} doesn't understand them
					if (!parseInt(param, 10)) {
						code += '|' + param + '=' + value;
					}
				});
			});
			code += '}}';

		} else {
			code = '{{db-' + params.csd[0];
			obj_entries(params.templateParams[0]).forEach(([param, value]) => {
				code += '|' + param + '=' + value;
			});
			if (params.notifyUser) {
				code += '|help=off';
			}
			code += '}}';
		}

		return code;
	}

	/**
	 * Creates this.params.utparams, object of parameters for the user notification
	 * template
	 */
	getUserTalkParameters() {
		let utparams: Record<string, string> = {};
		this.params.csd.forEach((csd) => {
			let subgroups = makeArray(this.flatObject[csd].subgroup);
			subgroups.forEach((subgroup, idx) => {
				if (subgroup.utparam && this.params[subgroup.name]) {
					// For {{db-csd-notice-custom}} (single criterion selected)
					utparams['key' + (idx + 1)] = subgroup.utparam;
					utparams['value' + (idx + 1)] = this.params[subgroup.name];
					// For {{db-notice-multiple}} (multiple criterion selected)
					utparams[subgroup.utparam] = this.params[subgroup.name];
				}
			});
		});
		this.params.utparams = utparams;
	}

	getUserNotificationText() {
		let params = this.params;
		let notifytext = '';
		// special cases: "db" and "db-multiple"
		if (params.normalizeds.length > 1) {
			notifytext = '\n{{subst:db-' + (params.warnUser ? 'deleted' : 'notice') + '-multiple|1=' + Morebits.pageNameNorm;
			params.normalizeds.forEach(function(norm, idx) {
				notifytext += '|' + (idx + 2) + '=' + norm.toUpperCase();
			});

		} else if (params.normalizeds[0] === 'db') {
			notifytext = '\n{{subst:db-reason-' + (params.warnUser ? 'deleted' : 'notice') + '|1=' + Morebits.pageNameNorm;

		} else {
			notifytext = '\n{{subst:db-csd-' + (params.warnUser ? 'deleted' : 'notice') + '-custom|1=';
			// Get rid of this by tweaking the template!
			if (params.csd[0] === 'copypaste') {
				notifytext += params.templateParams[0].sourcepage;
			} else {
				notifytext += Morebits.pageNameNorm;
			}
			notifytext += '|2=' + params.csd[0];
		}

		this.getUserTalkParameters();
		obj_entries(params.utparams).forEach(([key, value]) => {
			notifytext += '|' + key + '=' + value;
		});
		notifytext += (params.welcomeuser ? '' : '|nowelcome=yes') + '}} ~~~~';
		return notifytext;
	}

	fetchCreatorInfo() {
		let def = $.Deferred();
		// No user notification being made, no need to fetch creator
		if (!this.params.notifyUser && !this.params.warnUser) {
			return def.resolve();
		}
		let thispage = new Morebits.wiki.page(Morebits.pageNameNorm, 'Finding page creator');
		thispage.lookupCreation((pageobj) => {
			this.params.initialContrib = pageobj.getCreator();
			pageobj.getStatusElement().info('Found ' + pageobj.getCreator());
			def.resolve();
		});
		return def;
	}

	patrolPage() {
		if (Twinkle.getPref('markSpeedyPagesAsPatrolled')) {
			new Morebits.wiki.page(Morebits.pageNameNorm).triage();
		}
		return $.Deferred().resolve();
	}

	checkPage() {
		let def = $.Deferred();
		let pageobj = new Morebits.wiki.page(mw.config.get('wgPageName'), 'Tagging page');
		pageobj.setChangeTags(Twinkle.changeTags);
		pageobj.load((pageobj) => {
			let statelem = pageobj.getStatusElement();

			if (!pageobj.exists()) {
				statelem.error("It seems that the page doesn't exist; perhaps it has already been deleted");
				return def.reject();
			}

			let text = pageobj.getPageText();

			statelem.status('Checking for tags on the page...');

			// check for existing speedy deletion tags
			let tag = /(?:\{\{\s*(db|delete|db-.*?|speedy deletion-.*?)(?:\s*\||\s*\}\}))/.exec(text);
			// This won't make use of the db-multiple template but it probably should
			if (tag && !confirm('The page already has the CSD-related template {{' + tag[1] + '}} on it.  Do you want to add another CSD template?')) {
				return def.reject();
			}

			// check for existing XFD tags
			let xfd = /\{\{((?:article for deletion|proposed deletion|prod blp|template for discussion)\/dated|[cfm]fd\b)/i.exec(text) || /#invoke:(RfD)/.exec(text);
			if (xfd && !confirm('The deletion-related template {{' + xfd[1] + '}} was found on the page. Do you still want to add a CSD template?')) {
				return def.reject();
			}

			def.resolve(pageobj);
		}, def.reject);
		return def;
	}

	tagPage(pageobj: Morebits.wiki.page) {
		let def = $.Deferred();
		let params = this.params;
		let text = pageobj.getPageText();
		let code = this.getTaggingCode();

		// Set the correct value for |ts= parameter in {{db-g13}}
		if (params.normalizeds.indexOf('g13') !== -1) {
			code = code.replace('$TIMESTAMP', pageobj.getLastEditTime());
		}
		if (params.requestsalt) {
			code = '{{salt}}\n' + code;
		}

		// Post on talk if it is not possible to tag
		if (!pageobj.canEdit() || ['wikitext', 'Scribunto', 'javascript', 'css', 'sanitized-css'].indexOf(pageobj.getContentModel()) === -1) { // Attempt to place on talk page
			let talkName = new mw.Title(pageobj.getPageName()).getTalkPage().toText();

			if (talkName === pageobj.getPageName()) {
				pageobj.getStatusElement().error('Page protected and nowhere to add an edit request, aborting');
				return def.reject();
			}

			pageobj.getStatusElement().warn('Unable to edit page, placing tag on talk page');

			let talk_page = new Morebits.wiki.page(talkName, 'Automatically placing tag on talk page');
			talk_page.setNewSectionTitle(pageobj.getPageName() + ' nominated for CSD, request deletion');
			talk_page.setNewSectionText(code + '\n\nI was unable to tag ' + pageobj.getPageName() + ' so please delete it. ~~~~');
			talk_page.setCreateOption('recreate');
			talk_page.setFollowRedirect(true);
			talk_page.setWatchlist(params.watch);
			talk_page.setChangeTags(Twinkle.changeTags);
			talk_page.newSection(def.resolve, def.reject);
			return def;
		}

		// Remove tags that become superfluous with this action
		text = text.replace(/\{\{\s*([Uu]serspace draft)\s*(\|(?:\{\{[^{}]*\}\}|[^{}])*)?\}\}\s*/g, '');
		if (mw.config.get('wgNamespaceNumber') === 6) {
			// remove "move to Commons" tag - deletion-tagged files cannot be moved to Commons
			text = text.replace(/\{\{(mtc|(copy |move )?to ?commons|move to wikimedia commons|copy to wikimedia commons)[^}]*\}\}/gi, '');
		}

		// Wrap SD template in noinclude tags if we are in template space.
		// Won't work with userboxes in userspace, or any other transcluded page outside template space
		if (mw.config.get('wgNamespaceNumber') === 10) {  // Template:
			code = '<noinclude>' + code + '</noinclude>';
		}

		if (mw.config.get('wgPageContentModel') === 'Scribunto') {
			// Scribunto isn't parsed like wikitext, so CSD templates on modules need special handling to work
			let equals = '';
			while (code.indexOf(']' + equals + ']') !== -1) {
				equals += '=';
			}
			code = "require('Module:Module wikitext')._addText([" + equals + '[' + code + ']' + equals + ']);';
		} else if (['javascript', 'css', 'sanitized-css'].indexOf(mw.config.get('wgPageContentModel')) !== -1) {
			// Likewise for JS/CSS pages
			code = '/* ' + code + ' */';
		}

		// Generate edit summary for edit
		let editsummary;
		if (params.normalizeds[0] === 'db') {
			editsummary = 'Requesting [[WP:CSD|speedy deletion]] with rationale "' + params.templateParams[0]['1'] + '".';

		} else {
			let criteriaText = params.normalizeds.map((norm) => {
				return '[[WP:CSD#' + norm.toUpperCase() + '|CSD ' + norm.toUpperCase() + ']]';
			}).join(', ');
			editsummary = 'Requesting speedy deletion (' + criteriaText + ').';
		}

		// Blank attack pages
		if (params.redactContents) {
			text = code;
		} else {
			text = this.insertTagText(code, text);
		}

		pageobj.setPageText(text);
		pageobj.setEditSummary(editsummary);
		pageobj.setWatchlist(params.watch);
		pageobj.save(def.resolve, def.reject);

		return def;
	}

	/**
	 * Insert tag text on to the page.
	 * If they need to go at a location other than the very top of the page,
	 * override this function.
	 * @param code
	 * @param pageText
	 */
	insertTagText(code, pageText) {
		return code + '\n' + pageText;
	}

	noteToCreator() {
		let def = $.Deferred();
		let params = this.params;
		let initialContrib = params.initialContrib;

		// User notification not chosen
		if (!initialContrib) {
			return def.resolve();

			// disallow notifying yourself
		} else if (initialContrib === mw.config.get('wgUserName')) {
			Morebits.status.warn('Note','You (' + initialContrib + ') created this page; skipping user notification');
			initialContrib = null;

			// don't notify users when their user talk page is nominated/deleted
		} else if (initialContrib === mw.config.get('wgTitle') && mw.config.get('wgNamespaceNumber') === 3) {
			Morebits.status.warn('Note','Notifying initial contributor: this user created their own user talk page; skipping notification');
			initialContrib = null;

			// quick hack to prevent excessive unwanted notifications, per request. Should actually be configurable on recipient page...
		} else if ((initialContrib === 'Cyberbot I' || initialContrib === 'SoxBot') && params.normalizeds[0] === 'f2') {
			Morebits.status.warn('Note', 'Notifying initial contributor: page created procedurally by bot; skipping notification');
			initialContrib = null;

			// Check for already existing tags
		} else if (this.hasCSD && params.warnUser && !confirm('The page is has a deletion-related tag, and thus the creator has likely been notified.  Do you want to notify them for this deletion as well?')) {
			Morebits.status.info('Notifying initial contributor', 'canceled by user; skipping notification.');
			initialContrib = null;
		}

		if (!initialContrib) {
			params.initialContrib = null;
			return def.resolve();
		}

		let usertalkpage = new Morebits.wiki.page('User talk:' + initialContrib, 'Notifying initial contributor (' + initialContrib + ')');

		let editsummary = 'Notification: speedy deletion' + (params.warnUser ? '' : ' nomination');
		if (!params.redactContents) {  // no article name in summary for attack page taggings
			editsummary += ' of [[:' + Morebits.pageNameNorm + ']].';
		} else {
			editsummary += ' of an attack page.';
		}

		usertalkpage.setAppendText(this.getUserNotificationText());
		usertalkpage.setEditSummary(editsummary);
		usertalkpage.setChangeTags(Twinkle.changeTags);
		usertalkpage.setCreateOption('recreate');
		usertalkpage.setFollowRedirect(true, false);
		usertalkpage.append(def.resolve, def.reject);
		return def;
	}

	parseWikitext(wikitext): JQuery.Promise<string> {
		let statusIndicator = new Morebits.status('Building deletion summary');
		let api = new Morebits.wiki.api('Parsing deletion template', {
			action: 'parse',
			prop: 'text',
			pst: 'true',
			text: wikitext,
			contentmodel: 'wikitext',
			title: mw.config.get('wgPageName'),
			disablelimitreport: true,
			format: 'json'
		});
		api.setStatusElement(statusIndicator);
		return api.post().then( (apiobj) => {
			let reason = decodeURIComponent($(apiobj.getResponse().parse.text).find('#delete-reason').text()).replace(/\+/g, ' ');
			if (!reason) {
				statusIndicator.warn('Unable to generate summary from deletion template');
			} else {
				statusIndicator.info('complete');
			}
			return reason;
		});
	}

	parseDeletionReason() {
		let params = this.params;
		if (!params.normalizeds.length && params.normalizeds[0] === 'db') {
			params.deleteReason = prompt('Enter the deletion summary to use, which will be entered into the deletion log:', '');
			return $.Deferred().resolve();
		} else {
			let code = this.getTaggingCode();
			return this.parseWikitext(code).then((reason) => {
				if (params.promptForSummary) {
					reason = prompt('Enter the deletion summary to use, or press OK to accept the automatically generated one.', reason);
				}
				params.deleteReason = reason;
			});
		}
	}

	deletePage() {
		let def = $.Deferred();
		let params = this.params;

		let thispage = new Morebits.wiki.page(mw.config.get('wgPageName'), 'Deleting page');

		if (params.deleteReason === null) {
			Morebits.status.error('Asking for reason', 'User cancelled');
			return def.reject();
		} else if (!params.deleteReason || !params.deleteReason.trim()) {
			Morebits.status.error('Asking for reason', "you didn't give one.  I don't know... what with admins and their apathetic antics... I give up...");
			return def.reject();
		}

		thispage.setEditSummary(params.deleteReason);
		thispage.setChangeTags(Twinkle.changeTags);
		thispage.setWatchlist(params.watch);
		thispage.deletePage(() => {
			thispage.getStatusElement().info('done');
			def.resolve();
		}, def.reject);
		return def;
	}

	deleteTalk() {
		let def = $.Deferred();
		let params = this.params;
		if (params.deleteTalkPage &&
			document.getElementById('ca-talk').className !== 'new') {

			let talkpage = new Morebits.wiki.page(new mw.Title(Morebits.pageNameNorm).getTalkPage().toText(),
				'Deleting talk page');
			talkpage.setEditSummary('[[WP:CSD#G8|G8]]: Talk page of deleted page "' + Morebits.pageNameNorm + '"');
			talkpage.setChangeTags(Twinkle.changeTags);
			talkpage.deletePage(() => {
				talkpage.getStatusElement().info('done');
				def.resolve();
			}, def.reject);
		} else {
			def.resolve();
		}
		return def;
	}

	deleteRedirects() {
		let def = $.Deferred();
		let params = this.params;
		if (params.deleteRedirects) {
			let wikipedia_api = new Morebits.wiki.api('getting list of redirects...', {
				action: 'query',
				titles: mw.config.get('wgPageName'),
				prop: 'redirects',
				rdlimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
				format: 'json'
			});
			wikipedia_api.setStatusElement(new Morebits.status('Deleting redirects'));
			wikipedia_api.post().then((apiobj) => {
				let response = apiobj.getResponse();

				let snapshot = response.query.pages[0].redirects || [];
				let total = snapshot.length;
				let statusIndicator = apiobj.getStatusElement();

				if (!total) {
					statusIndicator.status('no redirects found');
					return;
				}

				statusIndicator.status('0%');

				let current = 0;
				let onsuccess = function(apiobjInner: Morebits.wiki.api) {
					let now = Math.round(100 * ++current / total) + '%';
					statusIndicator.update(now);
					apiobjInner.getStatusElement().unlink();
					if (current >= total) {
						statusIndicator.info(now + ' (completed)');
						def.resolve();
						Morebits.wiki.removeCheckpoint();
					}
				};

				Morebits.wiki.addCheckpoint();

				snapshot.forEach(function(value) {
					let title = value.title;
					let page = new Morebits.wiki.page(title, 'Deleting redirect "' + title + '"');
					page.setEditSummary('[[WP:CSD#G8|G8]]: Redirect to deleted page "' + Morebits.pageNameNorm + '"');
					page.setChangeTags(Twinkle.changeTags);
					page.deletePage(onsuccess);
				});
			});
		} else {
			def.resolve();
		}

		// promote Unlink tool
		let $link, $bigtext;
		let isFile = mw.config.get('wgNamespaceNumber') === 6;
		$link = $('<a>', {
			href: '#',
			text: 'click here to go to the Unlink tool',
			css: { fontSize: '130%', fontWeight: 'bold' },
			click: () => {
				Morebits.wiki.actionCompleted.redirect = null;
				this.dialog.close();
				Twinkle.unlink.callback(isFile ? 'Removing usages of and/or links to deleted file ' + Morebits.pageNameNorm : 'Removing links to deleted page ' + Morebits.pageNameNorm);
			}
		});
		$bigtext = $('<span>', {
			text: isFile ? 'To orphan backlinks and remove instances of file usage' : 'To orphan backlinks',
			css: { fontSize: '130%', fontWeight: 'bold' }
		});
		Morebits.status.info($bigtext[0], $link[0]);

		return def;
	}

	addToLog() {
		let params = this.params;
		let shouldLog = Twinkle.getPref('logSpeedyNominations') && params.normalizeds.some(function(norm) {
			return Twinkle.getPref('noLogOnSpeedyNomination').indexOf(norm) === -1;
		});
		if (!shouldLog) {
			return $.Deferred().resolve();
		}

		let usl = new Morebits.userspaceLogger(Twinkle.getPref('speedyLogPageName'));
		usl.initialText =
			"This is a log of all [[WP:CSD|speedy deletion]] nominations made by this user using [[WP:TW|Twinkle]]'s CSD module.\n\n" +
			'If you no longer wish to keep this log, you can turn it off using the [[Wikipedia:Twinkle/Preferences|preferences panel]], and ' +
			'nominate this page for speedy deletion under [[WP:CSD#U1|CSD U1]].' +
			(Morebits.userIsSysop ? '\n\nThis log does not track outright speedy deletions made using Twinkle.' : '');

		let extraInfo = '';

		// If a logged file is deleted but exists on commons, the wikilink will be blue, so provide a link to the log
		let fileLogLink = mw.config.get('wgNamespaceNumber') === 6 ? ' ([{{fullurl:Special:Log|page=' + mw.util.wikiUrlencode(mw.config.get('wgPageName')) + '}} log])' : '';

		let editsummary = 'Logging speedy deletion nomination';

		let appendText = '# [[:' + Morebits.pageNameNorm;


		if (!params.redactContents) {  // no article name in log for attack page taggings
			appendText += ']]' + fileLogLink + ': ';
			editsummary += ' of [[:' + Morebits.pageNameNorm + ']].';
		} else {
			appendText += '|This]] attack page' + fileLogLink + ': ';
			editsummary += ' of an attack page.';
		}

		if (params.normalizeds.length > 1) {
			let criteriaText = params.normalizeds.map((norm) => {
				return '[[WP:CSD#' + norm.toUpperCase() + '|' + norm.toUpperCase() + ']]';
			}).join(', ');
			appendText += 'multiple criteria (' + criteriaText + ')';
		} else if (params.normalizeds[0] === 'db') {
			appendText += '{{tl|db-reason}}';
		} else {
			appendText += '[[WP:CSD#' + params.normalizeds[0].toUpperCase() + '|CSD ' + params.normalizeds[0].toUpperCase() + ']] ({{tl|db-' + params.csd[0] + '}})';
		}

		// Treat custom rationale individually
		if (params.normalizeds[0] === 'db') {
			extraInfo += ` {Custom rationale: ${params.templateParams[0]['1']}}`;
		} else {
			params.csd.forEach((crit: string) => {
				let critObject = this.flatObject[crit];
				let critCode = critObject.code.toUpperCase();
				let subgroups = makeArray(critObject.subgroup);
				subgroups.forEach((subgroup) => {
					let value = params[subgroup.name];
					if (!value || !subgroup.parameter) {
						// no value was entered, or it's a hidden field or something
						return;
					}
					if (subgroup.log) {
						value = Morebits.string.safeReplace(subgroup.log, /\$1/g, value);
					} else if (subgroup.log === null) {
						// logging is disabled
						return;
					}
					extraInfo += ` {${critCode} ${subgroup.parameter}: ${value}}`;
				});
			});
		}

		if (params.requestsalt) {
			appendText += '; requested creation protection ([[WP:SALT|salting]])';
		}
		if (extraInfo) {
			appendText += '; additional information:' + extraInfo;
		}
		if (params.initialContrib) {
			appendText += '; notified {{user|1=' + params.initialContrib + '}}';
		}
		appendText += ' ~~~~~\n';

		usl.changeTags = Twinkle.changeTags;
		return usl.log(appendText, editsummary);
	}

	/**
	 * If validation fails, returns a string to be shown to user via alert(), if validation
	 * succeeds, doesn't return anything.
	 */
	validateInputs(): string | void {}

}
