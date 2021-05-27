import { generateArrowLinks, sortByNamespace } from '../utils';
import { Page } from '../Page';
import { Api } from '../Api';
import { Dialog } from '../Dialog';
import { msg } from '../messenger';
import { TwinkleModule } from '../twinkleModule';
import { getPref } from '../Config';

/**
 * Module for batch page undeletions. Can undelete all non-existing pages linked
 * from the current page. Optionally their respective talk pages can also be
 * undeleted.
 *
 * Localisation: Should work without any configuration.
 */
export class BatchUndeleteCore extends TwinkleModule {
	moduleName = 'batchundelete';
	static moduleName = 'batchundelete';

	portletName = 'Und-batch';
	portletId = 'twinkle-batchundelete';
	portletTooltip = "Undelete 'em all";
	windowTitle = 'Batch undelete';

	constructor() {
		super();
		if (
			!Morebits.userIsSysop ||
			!mw.config.get('wgArticleId') ||
			(mw.config.get('wgNamespaceNumber') !== mw.config.get('wgNamespaceIds').user &&
				mw.config.get('wgNamespaceNumber') !== mw.config.get('wgNamespaceIds').project)
		) {
			return;
		}
		this.addMenu();
	}

	makeWindow() {
		var Window = new Dialog(600, 400);
		Window.setTitle(this.windowTitle);
		Window.setFooterLinks(this.footerlinks);

		var form = new Morebits.quickForm(this.evaluate.bind(this));
		form.append({
			type: 'checkbox',
			list: [
				{
					label: msg('undbatch-restore-talks'),
					name: 'undel_talk',
					value: 'undel_talk',
					checked: true,
				},
			],
		});
		form.append({
			type: 'input',
			name: 'reason',
			label: 'Reason: ',
			size: 60,
		});

		var statusdiv = document.createElement('div');
		statusdiv.style.padding = '15px'; // just so it doesn't look broken
		Window.setContent(statusdiv);
		Morebits.status.init(statusdiv);
		Window.display();

		var query = {
			action: 'query',
			generator: 'links',
			prop: 'info',
			inprop: 'protection',
			titles: mw.config.get('wgPageName'),
			gpllimit: getPref('batchMax'),
			format: 'json',
		};
		var statelem = new Morebits.status(msg('fetching-list'));
		var wikipedia_api = new Api(msg('loading'), query);
		wikipedia_api.setStatusElement(statelem);
		wikipedia_api.post().then((apiobj) => {
			var response = apiobj.getResponse();
			var pages = (response.query && response.query.pages) || [];
			pages = pages.filter((page) => {
				return page.missing;
			});
			var list = [];
			pages.sort(sortByNamespace);
			pages.forEach((page) => {
				var editProt = page.protection
					.filter((pr) => {
						return pr.type === 'create' && pr.level === 'sysop';
					})
					.pop();

				var title = page.title;
				list.push({
					label:
						title +
						(editProt
							? msg('word-separator') +
							  (editProt.expiry === 'infinity'
									? msg('create-protected-indef')
									: msg('create-protected', new Morebits.date(editProt.expiry).calendar('utc')))
							: ''),
					value: title,
					checked: true,
					style: editProt ? 'color:red' : '',
				});
			});
			form.append({ type: 'header', label: msg('undbatch-pages-label') });
			form.append({
				type: 'button',
				label: msg('select-all'),
				event: (e) => {
					$(Morebits.quickForm.getElements(e.target.form, 'pages')).prop('checked', true);
				},
			});
			form.append({
				type: 'button',
				label: msg('deselect-all'),
				event: (e) => {
					$(Morebits.quickForm.getElements(e.target.form, 'pages')).prop('checked', false);
				},
			});
			form.append({
				type: 'checkbox',
				name: 'pages',
				shiftClickSupport: true,
				list: list,
			});
			form.append({ type: 'submit' });

			var result = form.render();
			Window.setContent(result);

			Morebits.quickForm.getElements(result, 'pages').forEach(generateArrowLinks);
		});
	}

	evaluate(event) {
		let form = event.target;
		Morebits.wiki.actionCompleted.notice = msg('undbatch-complete');

		var numProtected = Morebits.quickForm.getElements(form, 'pages').filter((element: HTMLInputElement) => {
			return element.checked && (element.nextElementSibling as HTMLLabelElement).style.color === 'red';
		}).length;
		if (numProtected > 0 && !confirm(msg('undbatch-confirm-protected', numProtected))) {
			return;
		}

		var input = Morebits.quickForm.getInputData(form) as {
			pages: string[];
			reason: string;
			undel_talk: boolean;
		};

		if (!input.reason) {
			return alert(msg('dbatch-give-reason'));
		}
		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(form);

		if (!input.pages || !input.pages.length) {
			Morebits.status.error(msg('error'), msg('undbatch-no-pages'));
			return;
		}

		var pageUndeleter = new Morebits.batchOperation(msg('undeleting'));
		pageUndeleter.setOption('chunkSize', getPref('batchChunks'));
		pageUndeleter.setOption('preserveIndividualStatusLines', true);
		pageUndeleter.setPageList(input.pages);
		pageUndeleter.run((pageName: string) => {
			var params = {
				page: pageName,
				undel_talk: input.undel_talk,
				reason: input.reason,
				pageUndeleter: pageUndeleter,
			};

			var wikipedia_page = new Page(pageName, msg('undeleting-page', pageName));
			wikipedia_page.setCallbackParameters(params);
			wikipedia_page.setEditSummary(input.reason);
			wikipedia_page.suppressProtectWarning();
			wikipedia_page.setMaxRetries(3); // temporary increase from 2 to make batchundelete more likely to succeed [[phab:T222402]] #613
			wikipedia_page.undeletePage().then(this.doExtras.bind(this), pageUndeleter.workerFailure);
		});
	}

	// this stupid parameter name is a temporary thing until I implement an overhaul
	// of Morebits.wiki.* callback parameters
	doExtras(thingWithParameters) {
		var params = thingWithParameters.parent
			? thingWithParameters.parent.getCallbackParameters()
			: thingWithParameters.getCallbackParameters();
		// the initial batch operation's job is to delete the page, and that has
		// succeeded by now
		params.pageUndeleter.workerSuccess(thingWithParameters);

		var query, wikipedia_api;

		if (params.undel_talk) {
			var talkpagename = new mw.Title(params.page).getTalkPage().getPrefixedText();
			if (talkpagename !== params.page) {
				query = {
					action: 'query',
					prop: 'deletedrevisions',
					drvprop: 'ids',
					drvlimit: 1,
					titles: talkpagename,
					format: 'json',
				};
				wikipedia_api = new Api(msg('check-talk-deleted'), query);
				wikipedia_api.params = params;
				wikipedia_api.params.talkPage = talkpagename;
				wikipedia_api.post().then(() => this.undeleteTalk(wikipedia_api));
			}
		}
	}

	undeleteTalk(apiobj: Api) {
		var page = apiobj.getResponse().query.pages[0];
		var exists = !page.missing;
		var delrevs = page.deletedrevisions && page.deletedrevisions[0].revid;

		if (exists || !delrevs) {
			// page exists or has no deleted revisions; forget about it
			return;
		}

		var talkpage = new Page(apiobj.params.talkPage, msg('undeleting-talk', apiobj.params.page));
		talkpage.setEditSummary(msg('undeleting-talk-summary', apiobj.params.page));
		talkpage.undeletePage();
	}
}
