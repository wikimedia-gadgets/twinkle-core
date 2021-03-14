import { Twinkle, TwinkleModule } from './twinkle';
import { generateArrowLinks, sortByNamespace } from './utils';
import { Page } from './Page';
import { Api } from './Api';

export class BatchUndeleteCore extends TwinkleModule {
	moduleName = 'batchundelete';
	static moduleName = 'batchundelete';

	portletName = 'Und-batch';
	portletId = 'twinkle-batchundelete';
	portletTooltip = "Undelete 'em all";

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
		var Window = new Morebits.simpleWindow(600, 400);
		Window.setScriptName('Twinkle');
		Window.setTitle('Batch undelete');
		Window.addFooterLink('Twinkle help', 'WP:TW/DOC#batchundelete');
		Window.addFooterLink('Give feedback', 'WT:TW');

		var form = new Morebits.quickForm(this.evaluate.bind(this));
		form.append({
			type: 'checkbox',
			list: [
				{
					label: 'Restore talk pages of undeleted pages if they existed',
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
			gpllimit: Twinkle.getPref('batchMax'),
			format: 'json',
		};
		var statelem = new Morebits.status('Grabbing list of pages');
		var wikipedia_api = new Morebits.wiki.api(
			'loading...',
			query,
			(apiobj) => {
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
								? ' (fully create protected' +
								  (editProt.expiry === 'infinity'
										? ' indefinitely'
										: ', expires ' + new Morebits.date(editProt.expiry).calendar('utc') + ' (UTC)') +
								  ')'
								: ''),
						value: title,
						checked: true,
						style: editProt ? 'color:red' : '',
					});
				});
				apiobj.params.form.append({ type: 'header', label: 'Pages to undelete' });
				apiobj.params.form.append({
					type: 'button',
					label: 'Select All',
					event: (e) => {
						$(Morebits.quickForm.getElements(e.target.form, 'pages')).prop('checked', true);
					},
				});
				apiobj.params.form.append({
					type: 'button',
					label: 'Deselect All',
					event: (e) => {
						$(Morebits.quickForm.getElements(e.target.form, 'pages')).prop('checked', false);
					},
				});
				apiobj.params.form.append({
					type: 'checkbox',
					name: 'pages',
					shiftClickSupport: true,
					list: list,
				});
				apiobj.params.form.append({ type: 'submit' });

				var result = apiobj.params.form.render();
				apiobj.params.Window.setContent(result);

				Morebits.quickForm.getElements(result, 'pages').forEach(generateArrowLinks);
			},
			statelem
		);
		wikipedia_api.params = { form: form, Window: Window };
		wikipedia_api.post();
	}

	evaluate(event) {
		let form = event.target;
		Morebits.wiki.actionCompleted.notice = 'Batch undeletion is now complete';

		var numProtected = Morebits.quickForm.getElements(form, 'pages').filter((element) => {
			return element.checked && element.nextElementSibling.style.color === 'red';
		}).length;
		if (
			numProtected > 0 &&
			!confirm('You are about to undelete ' + numProtected + ' fully create protected page(s). Are you sure?')
		) {
			return;
		}

		var input = Morebits.quickForm.getInputData(form) as {
			pages: string[];
			reason: string;
			undel_talk: boolean;
		};

		if (!input.reason) {
			alert('You need to give a reason, you cabal crony!');
			return;
		}
		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(form);

		if (!input.pages || !input.pages.length) {
			Morebits.status.error('Error', 'nothing to undelete, aborting');
			return;
		}

		var pageUndeleter = new Morebits.batchOperation('Undeleting pages');
		pageUndeleter.setOption('chunkSize', Twinkle.getPref('batchChunks'));
		pageUndeleter.setOption('preserveIndividualStatusLines', true);
		pageUndeleter.setPageList(input.pages);
		pageUndeleter.run((pageName: string) => {
			var params = {
				page: pageName,
				undel_talk: input.undel_talk,
				reason: input.reason,
				pageUndeleter: pageUndeleter,
			};

			var wikipedia_page = new Page(pageName, 'Undeleting page ' + pageName);
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
				wikipedia_api = new Morebits.wiki.api('Checking talk page for deleted revisions', query);
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

		var talkpage = new Page(apiobj.params.talkPage, 'Undeleting talk page of ' + apiobj.params.page);
		talkpage.setEditSummary('Undeleting [[Help:Talk page|talk page]] of "' + apiobj.params.page + '"');
		talkpage.undeletePage();
	}
}
