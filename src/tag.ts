import { Twinkle, TwinkleModule } from './twinkle';
import { makeArray, obj_entries, obj_values, stripNs } from './utils';

export interface tagData {
	// name of the tag template, without namespace prefix (required)
	tag: string

	// brief description
	description?: string

	// list of quickForm inputs to query from the user if tag is added
	subgroup?: tagSubgroup | tagSubgroup[]

	// should the tag not be included in grouping template (default: false)
	excludeInGroup?: boolean

	// should the tag be substed instead of transcluded (default: false)
	subst?: boolean

	// should the tag be allowed to be added a second time (default: false)
	dupeAllowed?: boolean
}

export interface tagSubgroup extends quickFormElementData {
	parameter?: string
}

export type tagListType = tagData[] | Record<string, (tagData[] | Record<string, tagData[]>)>

export class Tag extends TwinkleModule {
	static moduleName = 'Tag';
	mode: TagMode
	static modeList: (typeof TagMode)[]

	constructor() {
		super();
		for (let mode of Tag.modeList) {
			if (mode.isActive()) {
				// @ts-ignore
				this.mode = new mode();
				break;
			}
		}
		if (!this.mode) { // no mode is active
			return;
		}
		this.portletName = 'Tag';
		this.portletId = 'friendly-tag';
		this.portletTooltip = this.mode.getMenuTooltip();
		this.addMenu();
	}

	makeWindow() {
		var Window = new Morebits.simpleWindow(630, 500);
		Window.setScriptName(Twinkle.scriptName)
		// anyone got a good policy/guideline/info page/instructional page link??
		Window.addFooterLink('Twinkle help', 'WP:TW/DOC#tag');
		this.mode.makeForm(Window);
		this.mode.formRender();
		this.mode.postRender();
	}

	/**
	 * Adds a link to each template's description page
	 * @param {Morebits.quickForm.element} checkbox  associated with the template
	 */
	static makeArrowLinks(checkbox: HTMLInputElement) {
		var link = Morebits.htmlNode('a', '>');
		link.setAttribute('class', 'tag-template-link');
		// @ts-ignore
		var tagname = checkbox.values;
		link.setAttribute('href', mw.util.getUrl(
			(tagname.indexOf(':') === -1 ? 'Template:' : '') +
			(tagname.indexOf('|') === -1 ? tagname : tagname.slice(0, tagname.indexOf('|')))
		));
		link.setAttribute('target', '_blank');
		$(checkbox).parent().append('\u00A0', link);
	}

	static makeEditSummary(addedTags: string[], removedTags?: string[], reason?: string): string {
		let makeTemplateLink = function(tag: string) {
			let text = '{{[[';
			// if it is a custom tag with a parameter
			if (tag.indexOf('|') !== -1) {
				tag = tag.slice(0, tag.indexOf('|'));
			}
			text += tag.indexOf(':') !== -1 ? tag : 'Template:' + tag + '|' + tag;
			return text + ']]}}';
		};
		let summaryText;
		if (addedTags.length) {
			summaryText = 'Added ' + mw.language.listToText(addedTags.map(makeTemplateLink));
			summaryText += removedTags?.length ? '; and removed ' +
				mw.language.listToText(removedTags.map(makeTemplateLink)) : '';
		} else if (removedTags?.length) {
			summaryText = 'Removed ' + mw.language.listToText(removedTags.map(makeTemplateLink));
		}
		summaryText += ' tag' + (addedTags.length + removedTags?.length > 1 ? 's' : '');

		if (reason) {
			summaryText += ': ' + reason;
		}

		// avoid long summaries
		if (summaryText.length > 499) {
			summaryText = summaryText.replace(/\[\[[^|]+\|([^\]]+)\]\]/g, '$1');
		}
		return summaryText;
	}
}

export abstract class TagMode {
	abstract name: string
	abstract tagList: tagListType
	static tagList: tagListType; //
	flatObject: Record<string, tagData>
	existingTags: string[] = []

	Window: Morebits.simpleWindow
	form: Morebits.quickForm
	result: HTMLFormElement
	scrollbox: Morebits.quickForm.element
	params: Record<string, any>
	templateParams: Record<string, Record<string, string>>;
	pageText: string;
	pageobj: Twinkle.page;

	static isActive() { // must be overridden
		return false;
	}

	removalSupported = false; // Override to true for modes that support untagging

	/**
	 * Grouping
	 *
	 * A group template is a template container that takes the form
	 *
	 * {{group template name|
	 * {{tag template 1}}
	 * {{tag template 2}}
	 * }}
	 *
	 * Any other kind of "grouping" is not supported.
	 *
	 * If groupTemplateName is null, grouping is always disabled for the mode.
	 *
	 * Individual tags can be excluded from grouping by setting excludeInGroup=true
	 * for that template in tag data configuration.
	 *
	 * Grouping can also be disabled depending on user input or other factors by
	 * setting this.params.disableGrouping = true in the preprocessParams() hook.
	 *
	 */

	/**
	 * Name of grouping template.
	 * Default: null, which indicates no grouping template for the mode.
	 */
	groupTemplateName: string = null;

	/**
	 * Regex that matches the name of the group template name and its
	 * popular redirects
	 */
	groupTemplateNameRegex: string;

	/**
	 * Regex flags to apply to go along with groupTemplateNameRegex
	 */
	groupTemplateNameRegexFlags: string;

	/**
	 * Minimum number of tags that a group should contain
	 */
	groupMinSize = 1;

	/**
	 * Should tags that are not present in tag configuration be considered
	 * groupable? This includes custom tags set in user-level preferences,
	 * and tags found existing on the page which are absent in the config.
	 */
	assumeUnknownTagsGroupable = true;

	/**
	 * Removal of tags is possible only if this returns true:
	 * when the user is viewing the article in read mode or a permalink
	 * of the latest version.
	 */
	canRemove() {
		return this.removalSupported &&
			// Only on latest version of pages
			(mw.config.get('wgCurRevisionId') === mw.config.get('wgRevisionId')) &&
			// Disabled on latest diff because the diff slider could be used to slide
			// away from the latest diff without causing the script to reload
			!mw.config.get('wgDiffNewId');
	}

	getMenuTooltip() {
		return 'Add maintenance tags to the page';
	}

	getWindowTitle() {
		return 'Add maintenance tags';
	}

	makeForm(Window) {
		this.Window = Window;
		this.Window.setTitle(this.getWindowTitle());
		this.form = new Morebits.quickForm(() => this.evaluate());

		this.constructFlatObject();

		this.form.append({
			type: 'input',
			label: 'Filter tag list: ',
			name: 'quickfilter',
			size: '30px',
			event: QuickFilter.onInputChange
		});

		if (this.removalSupported && !this.canRemove()) {
			this.form.append({
				type: 'div',
				name: 'untagnotice',
				label: Morebits.htmlNode('div',  'For removal of existing tags, please open Tag menu from the current version of article')
			});
		}

		this.scrollbox = this.form.append({
			type: 'div',
			id: 'tagWorkArea',
			className: 'morebits-scrollbox',
			style: 'max-height: 28em'
		});

		this.parseExistingTags();
		this.makeExistingTagList(this.scrollbox);
		this.makeTagList(this.scrollbox);
	}

	makeTagList(container: Morebits.quickForm.element) {
		if (Array.isArray(this.tagList)) {
			this.makeTagListGroup(this.tagList, container);
		} else {
			$.each(this.tagList, (groupName, group) => {
				container.append({ type: 'header', label: groupName });
				if (Array.isArray(group)) { // if group is a list of tags
					this.makeTagListGroup(group, container);
				} else { // if group is a list of subgroups
					let subdiv = container.append({ type: 'div' });
					$.each(group, (subgroupName: string, subgroup: any[]) => {
						subdiv.append({ type: 'div', label: [Morebits.htmlNode('b', subgroupName)] });
						this.makeTagListGroup(subgroup, subdiv);
					});
				}
			});
		}
	}

	// helper function for makeTagList()
	makeTagListGroup(list: tagData[], container?: Morebits.quickForm.element | Morebits.quickForm) {

		let excludeTags = new Set(this.existingTags.filter(t => !this.flatObject[t]?.dupeAllowed));
		container.append({
			type: 'checkbox',
			name: 'tags',
			list: list.filter(item => !excludeTags.has(item.tag)).map((item) => ({
				label: '{{' + item.tag + '}}' + (item.description ? ': ' + item.description : ''),
				value: item.tag,
				subgroup: item.subgroup
			}))
		});
	}

	makeExistingTagList(container: Morebits.quickForm.element) {
		if (!this.existingTags.length) {
			return;
		}
		container.append({ type: 'header', label: 'Tags already present' });

		let tagConfigs = this.existingTags.map((tag) => {
			return this.flatObject[tag] || { tag };
		});
		container.append({
			type: 'checkbox',
			name: 'existingTags',
			list: tagConfigs.map((item) => ({
				label: '{{' + item.tag + '}}' + (item.description ? ': ' + item.description : ''),
				value: item.tag,
				checked: true,
				style: 'font-style: italic'
			}))
		});
	}

	/**
	 * Parse existing tags. This is NOT asynchronous.
	 * Should be overridden for tag modes where removalSupported is true.
	 * Populate this.existingTags with the names of tags present on the page.
	 */
	parseExistingTags() {}

	constructFlatObject() {
		this.flatObject = {};

		if (Array.isArray(this.tagList)) {
			// this.tagList is of type tagData[]
			this.tagList.forEach((item) => {
				this.flatObject[item.tag] = item;
			});
		} else {
			obj_values(this.tagList).forEach((group: tagData[] | Record<string, tagData[]>) => {
				// XXX: Can't figure out what's wrong with the type
				// @ts-ignore
				obj_values(group).forEach((subgroup: tagData | tagData[]) => {
					if (Array.isArray(subgroup)) {
						subgroup.forEach((item) => {
							this.flatObject[item.tag] = item;
						});
					} else {
						this.flatObject[subgroup.tag] = subgroup;
					}
				});
			});
		}
	}

	formAppendPatrolLink() {
		if (!document.getElementsByClassName('patrollink').length) {
			return;
		}
		this.form.append({
			type: 'checkbox',
			list: [{
				label: 'Mark the page as patrolled/reviewed',
				value: 'patrol',
				name: 'patrol',
				checked: Twinkle.getPref('markTaggedPagesAsPatrolled')
			}]
		});
	}

	formRender() {
		this.form.append({
			type: 'submit',
			className: 'tw-tag-submit'
		});
		this.result = this.form.render();
		this.Window.setContent(this.result);
		this.Window.display();
	}

	postRender() {
		QuickFilter.init(this.result);
		Morebits.quickForm.getElements(this.result, 'tags').forEach(Tag.makeArrowLinks);
		Morebits.quickForm.getElements(this.result, 'existingTags').forEach(Tag.makeArrowLinks);

		// style adjustments
		$(this.scrollbox).find('h5').css({ 'font-size': '110%' });
		$(this.scrollbox).find('h5:not(:first-child)').css({ 'margin-top': '1em' });
		$(this.scrollbox).find('div').filter(':has(span.quickformDescription)').css({ 'margin-top': '0.4em' });

		// Add status text node after Submit button
		let $status = $('<small>').attr('id', 'tw-tag-status');
		$status.insertAfter($('button.tw-tag-submit'));
		let addedCount = 0, removedCount = 0;

		// tally tags added/removed, update statusNode text
		$('[name=tags], [name=existingTags]').on('click', (e) => {
			let checkbox = e.target as HTMLInputElement;
			if (checkbox.name === 'tags') {
				addedCount += checkbox.checked ? 1 : -1;
			} else if (checkbox.name === 'existingTags') {
				removedCount += checkbox.checked ? -1 : 1;
			}

			let firstPart = `Adding ${addedCount} tag${addedCount > 1 ? 's' : ''}`;
			let secondPart = `Removing ${removedCount} tag${removedCount > 1 ? 's' : ''}`;
			let statusText = (addedCount ? firstPart : '') + (removedCount ? (addedCount ? '; ' : '') + secondPart : '');
			$status.text('  ' + statusText);
		});
	}

	evaluate() {
		this.captureFormData();
		let validationMessage = this.checkInputs();
		if (validationMessage) {
			return alert(validationMessage);
		}
		this.preprocessParams();
		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(this.result);
		this.action().then(() => {
			Morebits.status.actionCompleted(`Tagging complete, reloading ${this.name} in a few seconds`);
			setTimeout(() => {
				window.location.href = mw.util.getUrl(Morebits.pageNameNorm, {redirect: 'no'});
			}, 1e9);
		});
	}

	captureFormData() {
		this.params = Morebits.quickForm.getInputData(this.result);
		this.params.tagsToRemove = this.result.getUnchecked('existingTags'); // XXX: Morebits-defined function
		this.params.tagsToRetain = this.params.existingTags || [];
	}

	checkInputs(): string | void {
		// Check if any tag is selected or if any already present tag is deselected
		if (this.params.tags.length === 0 && (!this.canRemove() || this.params.tagsToRemove.length === 0)) {
			return 'You must select at least one tag!';
		}
		return this.validateInput();
	}

	/**
	 * If inputs are invalid, return a string that is shown to the user via alert().
	 * If inputs are valid, don't return anything.
	 */
	validateInput(): string | void {}

	preprocessParams() {
		this.getTemplateParameters();
	}

	getTemplateParameters() {
		this.templateParams = {};
		this.params.tags.forEach(tag => {
			this.templateParams[tag] = {};
			let subgroupObj = this.flatObject[tag] && this.flatObject[tag].subgroup;
			makeArray(subgroupObj).forEach((gr) => {
				if (gr.parameter && (this.params[gr.name] || gr.required)) {
					this.templateParams[tag][gr.parameter] = this.params[gr.name] || '';
				}
			});
		});
	}

	/**
	 * Get the regex to be used to search for or remove a tag.
	 * @param tag
	 */
	getTagRegex(tag: string) {
		return new RegExp('\\{\\{' + Morebits.pageNameRegex(tag) + '\\s*(\\|[^}]*)?\\}\\}\\n?');
	}

	/**
	 * This function assumes that grouping is enabled in the first place.
	 * @param tag
	 */
	isGroupable(tag: string): boolean {
		return this.flatObject[tag] ? !this.flatObject[tag].excludeInGroup : this.assumeUnknownTagsGroupable;
	}

	/**
	 * Get regex that matches the start of the grouping template (the opening braces plus
	 * the template name. The template name is captured as a regex group (pun unintended).
	 */
	groupRegex() {
		let regexString = '\\{\\{\\s*(' + this.groupTemplateNameRegex + ')\\s*(?:\\||\\}\\})';
		return new RegExp(regexString, this.groupTemplateNameRegexFlags);
	}

	/**
	 * Generate the parameter text from the data stored in this.templateParams.
	 * this.templateParams is populated automatically based on param names from the configs
	 * and values from user input. If any additional changes to templateParams are required,
	 * you can do that in preprocessParams().
	 * @param tag
	 */
	getParameterText(tag: string) {
		if (!this.templateParams[tag]) {
			mw.log.warn('this.templateParams[tag] undefined');
			return '';
		}
		return obj_entries(this.templateParams[tag]).map(([key, value]) => {
			return `|${key}=${value}`;
		}).join('');
	}

	getTagText(tag: string) {
		let subst = this.flatObject[tag] && this.flatObject[tag].subst ? 'subst:' : '';
		return '{{' + subst + tag + this.getParameterText(tag) + '}}';
	}

	makeTagSetText(tags: string[]) {
		return tags.map(tag => this.getTagText(tag) + '\n').join('');
	}

	addTagsOutsideGroup(tags) {
		let tagText = this.makeTagSetText(tags);
		this.pageText = this.insertTagText(tagText, this.pageText);
	}

	/**
	 * If the tag is present in pageText, removes it from pageText and adds it to
	 * params.groupableExistingTagsText.
	 * @param tag
	 */
	shiftTag(tag): boolean { // LIFT with spliceGroupableExistingTags
		let isShifted = false; // Avoid a .test() before the .replace() causing 2 regex searches
		this.pageText = this.pageText.replace(this.getTagRegex(tag), (tagText) => {
			isShifted = true;
			this.params.groupableExistingTagsText += tagText.trim() + '\n'; // add to groupableExistingTagsText
			return ''; // remove from pageText
		});
		return isShifted;
	}

	/**
	 * Get the wikitext of the groupable existing tags, removes it from the
	 * page text and adds them to params.groupableExistingTagsText, which
	 * the returned promise resolves to.
	 */
	spliceGroupableExistingTags(): JQuery.Promise<string> { // LIFT
		this.params.groupableExistingTagsText = '';
		let tagsToShiftAsync = this.params.groupableExistingTags.filter(tag => {
			return !this.shiftTag(tag);
		});
		if (tagsToShiftAsync.length === 0) {
			return $.Deferred().resolve(this.params.groupableExistingTagsText);
		}

		let api = new Morebits.wiki.api('Getting template redirects', this.getRedirectsQuery(tagsToShiftAsync));
		return api.post().then((apiobj) => {
			var pages = apiobj.getResponse().query.pages.filter(function(p) {
				return !p.missing && !!p.linkshere;
			});
			pages.forEach(page => {
				let shifted: boolean = this.shiftTag(stripNs(page.title));
				if (!shifted) {
					shifted = page.linkshere.some(template => {
						let tag = stripNs(template.title);
						return this.shiftTag(tag);
					});
				}
				if (!shifted) { // unnecessary message?
					new Morebits.status('Note', 'Failed to find {{' +
						stripNs(page.title) + '}} on the page... skip repositioning');
				}
			});
			return this.params.groupableExistingTagsText;
		});
	}

	/**
	 * Remove tag from pageText, if it exists.
	 * @param tag
	 * @returns true if tag was removed, false otherwise
	 */
	removeTemplate(tag): boolean { // LIFT with removeTags
		let isRemoved = false; // Avoid a .test() before the .replace() causing 2 regex searches
		this.pageText = this.pageText.replace(this.getTagRegex(tag), () => {
			isRemoved = true;
			return '';
		});
		return isRemoved;
	}

	getRedirectsQuery(tags: string[]) { // LIFT
		return {
			'action': 'query',
			'prop': 'linkshere',
			'titles': tags.map(pg => 'Template:' + pg),
			'redirects': 1,  // follow redirect if the class name turns out to be a redirect page
			'lhnamespace': '10',  // template namespace only
			'lhshow': 'redirect',
			'lhlimit': 'max', // 500 is max for normal users, 5000 for bots and sysops
			'format': 'json',
		};
	}

	/**
	 * Remove tags from pageText
	 */
	removeTags(): JQuery.Promise<void> { // LIFT
		let params = this.params;
		if (!params.tagsToRemove.length) {
			return $.Deferred().resolve();
		}
		Morebits.status.info('Untagging', 'Already present tags: removing de-selected tags');

		let tagsToRemoveAsync = params.tagsToRemove.filter(tag => {
			return !this.removeTemplate(tag);
		});

		if (tagsToRemoveAsync.length === 0) {
			return $.Deferred().resolve();
		}

		// Remove tags which appear in page text as redirects
		let statusMessage = `Getting redirects for ${mw.language.listToText(tagsToRemoveAsync.map(t => '{{' + t + '}}'))}`;
		let api = new Morebits.wiki.api(statusMessage, this.getRedirectsQuery(tagsToRemoveAsync));
		return api.post().then((apiobj) => {
			let pages = apiobj.getResponse().query.pages.filter(p => {
				return (!p.missing && !!p.linkshere) || Morebits.status.warn('Info', 'Failed to find {{' +
					stripNs(p.title) + '}} on the page... excluding');
			});
			(apiobj.getResponse().query.redirects || []).forEach(({ from, to }) => {
				new Morebits.status('Note', `Resolved template redirect {{${stripNs(from)}}} to {{${stripNs(to)}}}`);
			});
			pages.forEach(page => {
				let removed: boolean = this.removeTemplate(stripNs(page.title));
				if (!removed) {
					removed = page.linkshere.some(template => {
						let tag = stripNs(template.title);
						return this.removeTemplate(tag);
					});
				}
				if (!removed) {
					Morebits.status.warn('Note', 'Failed to find {{' +
						stripNs(page.title) + '}} on the page... cannot remove');
				}
			});
		});
	}

	initialCleanup(): void {}

	shouldAddGroup() {
		let params = this.params;
		return this.groupTemplateName && !params.disableGrouping &&
			(params.groupableExistingTags.length + params.groupableNewTags.length) >= this.groupMinSize;
	}

	/**
	 * Given that the group exists on `pageText` (either added by us now or existed before),
	 * move given `tagText` into the group
	 * @param tagText
	 */
	addTagsIntoGroup(tagText: string) {
		if (!tagText) {
			if (tagText === undefined) throw new Error('tagText undefined');
			return;
		}
		let groupRgxExec = this.groupRegex().exec(this.pageText);
		// Add new tags into group, and put the updated group wikitext into this.pageText
		let miRegex = new RegExp(
			'(\\{\\{\\s*' + // Opening braces
			groupRgxExec[1] + // template name
			// XXX: unnecessarily overspecific from this point onwards
			'\\s*(?:\\|(?:\\{\\{[^{}]*\\}\\}|[^{}])*)?)' + // ??? Copied from friendlytag
			'\\}\\}\\s*' // Closing braces, followed by spaces/newlines
			, 'im');
		this.pageText = this.pageText.replace(miRegex, '$1' + tagText + '}}\n');
	}


	/**
	 * Controls how the final text of new tags is inserted into the page.
	 * Defaults to just putting them at the very top of the page, along with two newlines.
	 * You may want to override this if you want them to go below any hatnotes or deletion
	 * notices (use Morebits.wikitext.page#insertAfterTemplates, see enwiki ArticleMode).
	 * @param tagText
	 * @param pageText
	 */
	insertTagText(tagText: string, pageText: string): string {
		return tagText + '\n' + pageText;
	}

	finalCleanup() {
		if (!this.groupTemplateName || this.params.groupingDisabled) {
			return;
		}
		// Remove any groups containing less than minGroupSize tags

		// XXX: This might misbehave if existing tags in the MI have parameters
		// that contain nested templates.
		// TODO: use regex-less parsing.

		const nItemGroupRegex = (n: number) => {
			let start = '\\{\\{\\s*' + this.groupTemplateNameRegex + '\\s*\\|\\s*(';
			let tags = '(?:\\{\\{[^}]+\\}\\}\\s*){' + n + '}';
			let end = ')\\}\\}\\n?';
			let regexString = start + tags + end;
			return new RegExp(regexString, this.groupTemplateNameRegexFlags);
		};

		// unbind substs of time parser functions
		let unbinder = new Morebits.unbinder(this.pageText);
		unbinder.unbind('\\{\\{subst:CURRENT', '\\}\\}');

		for (let i = 0; i < this.groupMinSize; i++) {
			unbinder.content = unbinder.content.replace(nItemGroupRegex(i), '$1');
		}
		this.pageText = unbinder.rebind();
	}

	action() {
		this.pageobj = new Twinkle.page(Morebits.pageNameNorm, 'Tagging ' + this.name);
		return this.pageobj.load().then((pageobj) => {
			this.pageText = pageobj.getPageText();
			this.initialCleanup();
			this.sortTags();
			return $.when(this.addAndRearrangeTags(), this.removeTags()).then(() => {
				this.finalCleanup();
				return this.savePage();
			});
		});
	}

	sortTags() {}

	addAndRearrangeTags() {
		this.pageText = this.insertTagText(this.makeTagSetText(this.params.tags), this.pageText);
	}

	savePage() {
		this.pageobj.setPageText(this.pageText);
		this.pageobj.setEditSummary(Tag.makeEditSummary(this.params.tags,
			this.params.tagsToRemove, this.params.reason));
		this.pageobj.setWatchlist(Twinkle.getPref('watchTaggedPages'));
		this.pageobj.setMinorEdit(Twinkle.getPref('markTaggedPagesAsMinor'));
		this.pageobj.setCreateOption('nocreate');

		if (this.params.patrol) {
			this.pageobj.triage();
		}
		return this.pageobj.save();
	}

}

export class QuickFilter {
	static $allCheckboxDivs: JQuery
	static $allHeaders: JQuery

	static init(result: HTMLFormElement) {
		QuickFilter.$allCheckboxDivs = $(result).find('[name=tags], [name=existingTags]').parent();
		QuickFilter.$allHeaders = $(result).find('h5, .quickformDescription');
		result.quickfilter.focus(); // place cursor in the quick filter field as soon as window is opened
		result.quickfilter.autocomplete = 'off'; // disable browser suggestions
		result.quickfilter.addEventListener('keypress', function (e) {
			if (e.keyCode === 13) { // prevent enter key from accidentally submitting the form
				e.preventDefault();
				return false;
			}
		});
	}
	static onInputChange(this: HTMLInputElement) {
		// flush the DOM of all existing underline spans
		QuickFilter.$allCheckboxDivs.find('.search-hit').each(function (i, e) {
			var label_element = e.parentElement;
			// This would convert <label>Hello <span class=search-hit>wo</span>rld</label>
			// to <label>Hello world</label>
			label_element.innerHTML = label_element.textContent;
		});

		if (this.value) {
			QuickFilter.$allCheckboxDivs.hide();
			QuickFilter.$allHeaders.hide();
			var searchString = this.value;
			var searchRegex = new RegExp(mw.util.escapeRegExp(searchString), 'i');

			QuickFilter.$allCheckboxDivs.find('label').each(function () {
				var label_text = this.textContent;
				var searchHit = searchRegex.exec(label_text);
				if (searchHit) {
					var range = document.createRange();
					var textnode = this.childNodes[0];
					range.selectNodeContents(textnode);
					range.setStart(textnode, searchHit.index);
					range.setEnd(textnode, searchHit.index + searchString.length);
					var underline_span = $('<span>').addClass('search-hit').css('text-decoration', 'underline')[0];
					range.surroundContents(underline_span);
					this.parentElement.style.display = 'block'; // show
				}
			});
		} else {
			QuickFilter.$allCheckboxDivs.show();
			QuickFilter.$allHeaders.show();
		}
	}
}
