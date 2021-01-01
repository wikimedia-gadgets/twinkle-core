import { Twinkle, TwinkleModule } from './twinkle';

export class Xfd extends TwinkleModule {
	static moduleName = 'XFD';

	mode: XfdMode
	static modeList: (typeof XfdMode)[]

	Window: Morebits.simpleWindow;
	fieldset: Morebits.quickForm.element;
	result: HTMLFormElement;

	constructor() {
		super();
		for (let mode of Xfd.modeList) {
			if (mode.isDefaultChoice()) {
				// @ts-ignore
				this.mode = new mode();
				break;
			}
		}
		this.portletName = 'XFD';
		this.portletId = 'twinkle-xfd';
		this.portletTooltip = this.getMenuTooltip();
		this.addMenu();
	}

	getMenuTooltip() {
		if (this.mode) {
			return this.mode.getMenuTooltip();
		} else {
			return 'Start a deletion discussion';
		}
	}

	makeWindow() {
		var Window = new Morebits.simpleWindow(700, 400);
		Window.setTitle('Start a deletion discussion (XfD)');
		Window.setScriptName(Twinkle.scriptName)
		Window.addFooterLink('About deletion discussions', 'WP:XFD');
		Window.addFooterLink('XfD prefs', 'WP:TW/PREF#xfd');
		Window.addFooterLink('Twinkle help', 'WP:TW/DOC#xfd');
		this.makeForm(Window);
	}

	// invoked only once
	makeForm(Window) {
		this.Window = Window;
		let form = new Morebits.quickForm(() => { this.mode.evaluate(); });

		form.append({
			type: 'select',
			name: 'venue',
			label: 'Deletion discussion venue:',
			tooltip: 'When activated, a default choice is made, based on what namespace you are in. This default should be the most appropriate.',
			event: this.onCategoryChange.bind(this),
			list: Xfd.modeList.map((mode) => ({
				type: 'option',
				label: mode.venueLabel,
				selected: this.mode instanceof mode,
				value: mode.venueCode
			}))
		});

		form.append({
			type: 'div',
			id: 'wrong-venue-warn',
			style: 'color: red; font-style: italic'
		});

		form.append({
			type: 'checkbox',
			list: [
				{
					label: 'Notify page creator if possible',
					value: 'notify',
					name: 'notifycreator',
					tooltip: "A notification template will be placed on the creator's talk page if this is true.",
					checked: true
				}
			]
		});

		this.fieldset = form.append({
			type: 'field',
			label: 'Work area',
			name: 'work_area'
		});

		var previewlink = document.createElement('a');
		$(previewlink).click(() => {
			this.mode.preview(this.result);  // |result| is defined below
		});
		previewlink.style.cursor = 'pointer';
		previewlink.textContent = 'Preview';
		form.append({ type: 'div', id: 'xfdpreview', label: [ previewlink ] });
		form.append({ type: 'div', id: 'twinklexfd-previewbox', style: 'display: none' });

		form.append({ type: 'submit' });

		this.result = form.render();
		Window.setContent(this.result);
		Window.display();
		this.result.previewer = new Morebits.wiki.preview(document.getElementById('twinklexfd-previewbox'));

		// We must init the controls
		var evt = document.createEvent('Event');
		evt.initEvent('change', true, true);
		this.result.venue.dispatchEvent(evt);

		return form;
	}

	// invoked on every mode change
	onCategoryChange(evt) {
		var venueCode = evt.target.value;
		var form = evt.target.form;

		let mode = Xfd.modeList.filter((mode) => {
			return mode.venueCode === venueCode;
		})[0];
		if (!mode) {
			throw new Error('Unrecognized venue: ' +  venueCode); // should never happen
		}
		// @ts-ignore
		this.mode = new mode();
		this.mode.result = this.result;
		this.mode.Window = this.Window;

		$('#wrong-venue-warn').text(this.mode.getVenueWarning() || '');
		form.previewer.closePreview();

		let renderedFieldset = this.mode.generateFieldset().render();
		$(this.result).find('fieldset[name=work_area]')
			.replaceWith(renderedFieldset);
		this.mode.postRender(renderedFieldset as HTMLFieldSetElement);
	}
}


export abstract class XfdMode {
	static venueCode: string
	static venueLabel: string

	// must be overridden, unless the venue is never the default choice
	static isDefaultChoice(): boolean {
		return false;
	}

	Window: Morebits.simpleWindow
	fieldset: Morebits.quickForm.element
	result: HTMLFormElement
	params: Record<string, any>
	tm: Morebits.taskManager

	/**
	 * Used in determineDiscussionPage(), applicable only if in the XfD process, each page is
	 * discussed on a separate page (like AfD and MfD). Otherwise this can be skipped.
	 */
	discussionPagePrefix: string;

	getMenuTooltip(): string {
		return 'Nominate page for deletion';
	}

	generateFieldset(): Morebits.quickForm.element {
		this.fieldset = new Morebits.quickForm.element({
			type: 'field',
			label: this.getFieldsetLabel(),
			name: 'work_area'
		});
		return this.fieldset;
	}
	appendReasonArea() {
		this.fieldset.append({
			type: 'textarea',
			name: 'reason',
			label: 'Reason: ',
			value: $(this.result).find('textarea').val() as string || '',
			tooltip: 'You can use wikimarkup in your reason. Twinkle will automatically sign your post.'
		});
	}

	// Used as the label for the fieldset in the UI, and in the default notification edit summary
	abstract getFieldsetLabel()

	postRender(renderedFieldset: HTMLFieldSetElement) {}

	getVenueWarning(): string | void {}

	// Overridden for tfd, cfd, cfds
	/**
	 * Pre-process parameters, called from evaluate() and preview().
	 */
	preprocessParams(): void {}

	// Overridden for ffd and rfd, which need special treatment
	preview(form: HTMLFormElement) {
		this.params = Morebits.quickForm.getInputData(form);
		this.preprocessParams();
		this.showPreview(form);
	}

	// This is good enough to use without override for all venues except rm
	showPreview(form: HTMLFormElement) {
		let templatetext = this.getDiscussionWikitext();
		form.previewer.beginRender(templatetext, 'WP:TW'); // Force wikitext
	}

	abstract getDiscussionWikitext(): string

	evaluate(): void {
		this.params = Morebits.quickForm.getInputData(this.result);
		this.preprocessParams();
		if (!this.validateInput()) {
			return;
		}
		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(this.result);

		this.tm = new Morebits.taskManager(this);
	}

	/**
	 * Hook for form validation. If this returns false, form submission is aborted
	 */
	validateInput(): boolean {
		return true;
	}

	/**
	 * Print reason text if we fail to post the reason to the designated place on the wiki, so that
	 * the user can reuse the text.
	 * Should be invoked as a onFailure method in Morebits.taskManager.
	 * This function shouldn't need to be overridden.
	 */
	printReasonText() {
		Morebits.status.printUserText(this.params.reason, 'Your deletion rationale is provided below, which you can copy and paste into a new XFD dialog if you wish to try again:');
	}

	/**
	 * Callback to redirect to the discussion page when everything is done. Relies on the discussion page
	 * being known as either `this.params.discussionpage` or `this.params.logpage`.
	 */
	redirectToDiscussion() {
		let redirPage = this.params.discussionpage || this.params.logpage;
		Morebits.status.actionCompleted("Nomination complete, now redirecting to the discussion page");
		setTimeout(() => {
			window.location.href = mw.util.getUrl(redirPage);
		}, Morebits.wiki.actionCompleted.timeOut);
	}

	/**
	 * Only applicable for XFD processes that use separate discussion pages for every page.
	 */
	determineDiscussionPage() {
		let params = this.params;
		let wikipedia_api = new Morebits.wiki.api('Looking for prior nominations of this page', {
			'action': 'query',
			'list': 'allpages',
			'apprefix': new mw.Title(this.discussionPagePrefix).getMain() + '/' + Morebits.pageNameNorm,
			'apnamespace': 4,
			'apfilterredir': 'nonredirects',
			'aplimit': 'max', // 500 is max for normal users, 5000 for bots and sysops
			'format': 'json'
		});
		return wikipedia_api.post().then((apiobj) => {
			var response = apiobj.getResponse();
			var titles = response.query.allpages;

			// There has been no earlier entries with this prefix, just go on.
			if (titles.length <= 0) {
				params.numbering = params.number = '';
			} else {
				var number = 0;
				var order_re = new RegExp('^' +
					Morebits.string.escapeRegExp(this.discussionPagePrefix + '/' + Morebits.pageNameNorm) +
					'\\s*\\(\\s*(\\d+)(?:(?:th|nd|rd|st) nom(?:ination)?)?\\s*\\)\\s*$');
				for (var i = 0; i < titles.length; ++i) {
					var title = titles[i].title;

					// First, simple test, is there an instance with this exact name?
					if (title === this.discussionPagePrefix + '/' + Morebits.pageNameNorm) {
						number = Math.max(number, 1);
						continue;
					}

					var match = order_re.exec(title);

					// No match; A non-good value
					if (!match) {
						continue;
					}

					// A match, set number to the max of current
					number = Math.max(number, Number(match[1]));
				}
				params.number = num2order(number + 1);
				params.numbering = number > 0 ? ' (' + params.number + ' nomination)' : '';
			}
			params.discussionpage = this.discussionPagePrefix + '/' + Morebits.pageNameNorm + params.numbering;

			apiobj.getStatusElement().info('next in order is ' + params.discussionpage);
		});
	}

	autoEditRequest(pageobj) {
		let params = this.params;

		var talkName = new mw.Title(pageobj.getPageName()).getTalkPage().toText();
		if (talkName === pageobj.getPageName()) {
			pageobj.getStatusElement().error('Page protected and nowhere to add an edit request, aborting');
			return $.Deferred().reject();
		}
		pageobj.getStatusElement().warn('Page protected, requesting edit');

		var editRequest = '{{subst:Xfd edit protected|page=' + pageobj.getPageName() +
			'|discussion=' + params.discussionpage + '|tag=<no' + 'wiki>' + params.tagText + '<no' + 'wiki>}}';

		var talk_page = new Twinkle.page(talkName, 'Automatically posting edit request on talk page');
		talk_page.setNewSectionTitle('Edit request to complete ' + toTLACase(params.venue) + ' nomination');
		talk_page.setNewSectionText(editRequest);
		talk_page.setCreateOption('recreate');
		talk_page.setWatchlist(Twinkle.getPref('xfdWatchPage'));
		talk_page.setFollowRedirect(true);  // should never be needed, but if the article is moved, we would want to follow the redirect

		return talk_page.newSection().catch(function() {
			talk_page.getStatusElement().warn('Unable to add edit request, the talk page may be protected');
			return $.Deferred().reject();
		});

	}

	fetchCreatorInfo() {

		let thispage = new Twinkle.page(Morebits.pageNameNorm, 'Finding page creator');
		thispage.setLookupNonRedirectCreator(this.params.lookupNonRedirectCreator);
		return thispage.lookupCreation().then((pageobj) => {
			this.params.initialContrib = pageobj.getCreator();
			pageobj.getStatusElement().info('Found ' + pageobj.getCreator());
		});

	}

	notifyTalkPage(notifyTarget: string, statusElement?: Morebits.status): JQuery.Promise<void> {
		// Ensure items with User talk or no namespace prefix both end
		// up at user talkspace as expected, but retain the
		// prefix-less username for addToLog
		let params = this.params;

		var notifyTitle = mw.Title.newFromText(notifyTarget, 3); // 3: user talk
		var targetNS = notifyTitle.getNamespaceId();
		var usernameOrTarget = notifyTitle.getRelativeText(3);
		statusElement = statusElement || new Morebits.status('Notifying initial contributor (' + usernameOrTarget + ')');

		let notifyPageTitle = notifyTitle.toText();
		if (targetNS === 3) {
			// Disallow warning yourself
			if (usernameOrTarget === mw.config.get('wgUserName')) {
				params.initialContrib = null; // disable initial contributor logging in userspace log
				statusElement.warn('You (' + usernameOrTarget + ') created this page; skipping user notification');
				return $.Deferred().resolve();
			}
		}

		var usertalkpage = new Twinkle.page(notifyPageTitle, statusElement);
		usertalkpage.setAppendText('\n\n' + this.getNotifyText());
		usertalkpage.setEditSummary(this.getNotifyEditSummary());
		usertalkpage.setCreateOption('recreate');
		// Different pref for RfD target notifications: XXX: handle this better!
		if (params.venue === 'rfd' && targetNS !== 3) {
			usertalkpage.setWatchlist(Twinkle.getPref('xfdWatchRelated'));
		} else {
			usertalkpage.setWatchlist(Twinkle.getPref('xfdWatchUser'));
		}
		usertalkpage.setFollowRedirect(true, false);
		return usertalkpage.append().catch(() => {
			// if user could not be notified, null this out for correct userspace logging,
			// but don't reject the promise
			params.initialContrib = null;
		});

	}

	// Overridden for all venues except FFD and RFD
	getNotifyText(): string {
		return `{{subst:${this.params.venue} notice|1=${Morebits.pageNameNorm}}} ~~~~`;
	}

	// Not overridden for any venue
	getNotifyEditSummary(): string {
		return 'Notification: [[' + this.params.discussionpage + '|listing]] of [[:' +
			Morebits.pageNameNorm + ']] at [[WP:' + this.getFieldsetLabel() + ']].';
	}

	notifyCreator(): JQuery.Promise<void> {
		if (!this.params.notifycreator) {
			this.params.intialContrib = null;
			return $.Deferred().resolve();
		}
		return this.notifyTalkPage(this.params.initialContrib);
	}

	// Should be called after notifyTalkPage() which may unset this.params.intialContrib
	addToLog() {
		let params = this.params;

		if (!Twinkle.getPref('logXfdNominations') ||
			Twinkle.getPref('noLogOnXfdNomination').indexOf(params.venue) !== -1) {
			return $.Deferred().resolve();
		}

		var usl = new Morebits.userspaceLogger(Twinkle.getPref('xfdLogPageName'));// , 'Adding entry to userspace log');

		usl.initialText =
			"This is a log of all [[WP:XFD|deletion discussion]] nominations made by this user using [[WP:TW|Twinkle]]'s XfD module.\n\n" +
			'If you no longer wish to keep this log, you can turn it off using the [[Wikipedia:Twinkle/Preferences|preferences panel]], and ' +
			'nominate this page for speedy deletion under [[WP:CSD#U1|CSD U1]].' +
			(Morebits.userIsSysop ? '\n\nThis log does not track XfD-related deletions made using Twinkle.' : '');

		usl.changeTags = Twinkle.changeTags;
		return usl.log(this.getUserspaceLoggingText(), this.getUserspaceLoggingEditSummary());
	}

	getUserspaceLoggingEditSummary() {
		return 'Logging ' + toTLACase(this.params.venue) + ' nomination of [[:' + Morebits.pageNameNorm + ']].';
	}

	getUserspaceLoggingText(): string {
		let params = this.params;

		// If a logged file is deleted but exists on commons, the wikilink will be blue, so provide a link to the log
		var fileLogLink = mw.config.get('wgNamespaceNumber') === 6 ? ' ([{{fullurl:Special:Log|page=' + mw.util.wikiUrlencode(mw.config.get('wgPageName')) + '}} log])' : '';
		// CFD/S and RM don't have canonical links
		var nominatedLink = params.discussionpage ? '[[' + params.discussionpage + '|nominated]]' : 'nominated';

		var appendText = '# [[:' + Morebits.pageNameNorm + ']]:' + fileLogLink + ' ' + nominatedLink + ' at [[WP:' + params.venue.toUpperCase() + '|' + toTLACase(params.venue) + ']]';

		appendText += this.getUserspaceLoggingExtraInfo();

		if (params.initialContrib && params.notifycreator) {
			appendText += '; notified {{user|1=' + params.initialContrib + '}}';
		}
		appendText += ' ~~~~~';
		if (params.reason) {
			appendText += "\n#* '''Reason''': " + Morebits.string.formatReasonForLog(params.reason);
		}
		return appendText;
	}

	getUserspaceLoggingExtraInfo() {
		return '';
	}

}

/** Get ordinal number figure */
export function num2order(num: number): string {
	switch (num) {
		case 1: return '';
		case 2: return '2nd';
		case 3: return '3rd';
		default: return num + 'th';
	}
}

/**
 * Provide Wikipedian TLA style: AfD, RfD, CfDS, RM, SfD, etc.
 * @param {string} venue
 * @returns {string}
 */
export function toTLACase(venue: string): string {
	return venue
		.toString()
		// Everybody up, including rm and the terminal s in cfds
		.toUpperCase()
		// Lowercase the central f in a given TLA and normalize sfd-t and sfr-t
		.replace(/(.)F(.)(?:-.)?/, '$1f$2');
}

