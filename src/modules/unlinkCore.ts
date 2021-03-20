import { generateBatchPageLinks, sortByNamespace } from '../utils';
import { Dialog } from '../Dialog';
import { Page } from '../Page';
import { Api } from '../Api';
import { msg } from '../messenger';
import { TwinkleModule } from '../twinkleModule';
import { getPref } from '../Config';

export class UnlinkCore extends TwinkleModule {
	moduleName = 'unlink';
	static moduleName = 'unlink';

	portletId = 'twinkle-unlink';
	portletName = 'Unlink';
	portletTooltip = 'Unlink backlinks';

	/**
	 * Return true if the module can be used on the current page by the current user,
	 * false otherwise
	 */
	isUsable(): boolean {
		return (
			mw.config.get('wgNamespaceNumber') >= 0 &&
			mw.config.get('wgPageName') !== 'Wikipedia:Sandbox' &&
			(Morebits.userIsInGroup('extendedconfirmed') || Morebits.userIsSysop)
		);
	}

	constructor() {
		super();
		if (this.isUsable()) {
			this.addMenu();
		}
	}

	// the parameter is used when invoking unlink from admin speedy
	makeWindow(presetReason?) {
		var fileSpace = mw.config.get('wgNamespaceNumber') === 6;

		var Window = new Dialog(600, 440);
		Window.setTitle(fileSpace ? msg('unlink-title-file') : msg('unlink-title'));
		Window.setFooterLinks(this.footerlinks);

		var form = new Morebits.quickForm(this.evaluate.bind(this));

		form.append({
			type: 'div',
			style: 'margin-bottom: 0.5em;',
			// prepend some documentation: files are commented out, while any
			// display text is preserved for links (otherwise the link itself is used)
			label: $.parseHTML(
				fileSpace ? msg('unlink-intro-file', Morebits.pageNameNorm) : msg('unlink-intro', Morebits.pageNameNorm)
			),
		});

		form.append({
			type: 'input',
			name: 'reason',
			label: msg('reason'),
			value: presetReason ? presetReason : '',
			size: 60,
		});

		var query = {
			action: 'query',
			list: ['backlinks'],
			bltitle: mw.config.get('wgPageName'),
			bllimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
			blnamespace: getPref('unlinkNamespaces'),
			rawcontinue: true,
			format: 'json',
		};
		if (fileSpace) {
			query.list.push('imageusage');
			$.extend(query, {
				iutitle: query.bltitle,
				iulimit: query.bllimit,
				iunamespace: query.blnamespace,
			});
		} else {
			$.extend(query, {
				blfilterredir: 'nonredirects',
			});
		}
		var wikipedia_api = new Api(msg('fetching-backlinks'), query);
		wikipedia_api.params = { form: form, Window: Window, image: fileSpace };
		wikipedia_api.post().then(this.displayBacklinks);

		var root = document.createElement('div');
		root.style.padding = '15px'; // just so it doesn't look broken
		Morebits.status.init(root);
		wikipedia_api.getStatusElement().status(msg('loading'));
		Window.setContent(root);
		Window.display();
	}

	evaluate(event) {
		var form = event.target;
		var input = Morebits.quickForm.getInputData(form) as {
			backlinks: string[];
			imageusage: string[];
			reason: string;
		};

		if (!input.reason) {
			return alert(msg('unlink-give-reason'));
		}

		input.backlinks = input.backlinks || [];
		input.imageusage = input.imageusage || [];
		var pages = Morebits.array.uniq(input.backlinks.concat(input.imageusage));
		if (!pages.length) {
			return alert('unlink-select-one');
		}

		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(form);

		var unlinker = new Morebits.batchOperation(
			input.backlinks.length
				? input.imageusage.length
					? msg('unlink-status-links-files')
					: msg('unlink-status-links')
				: msg('unlink-status-files')
		);
		unlinker.setOption('preserveIndividualStatusLines', true);
		unlinker.setPageList(pages);
		var params = { reason: input.reason, unlinker: unlinker };
		unlinker.run((pageName: string) => {
			var wikipedia_page = new Page(pageName, msg('unlink-in', pageName));
			wikipedia_page.setBotEdit(true); // unlink considered a floody operation
			wikipedia_page.setCallbackParameters(
				$.extend(
					{
						doBacklinks: input.backlinks.indexOf(pageName) !== -1,
						doImageusage: input.imageusage.indexOf(pageName) !== -1,
					},
					params
				)
			);
			wikipedia_page.load().then(() => this.unlinkBacklinks(wikipedia_page));
		});
	}

	displayBacklinks(apiobj: Api) {
		var response = apiobj.getResponse();
		let { form, Window, image } = apiobj.params;
		var havecontent = false;
		var list, namespaces, i;

		if (image) {
			var imageusage = response.query.imageusage.sort(sortByNamespace);
			list = [];
			for (i = 0; i < imageusage.length; ++i) {
				// Label made by Twinkle.generateBatchPageLinks
				list.push({ label: '', value: imageusage[i].title, checked: true });
			}
			if (!list.length) {
				form.append({ type: 'div', label: msg('no-file-usage') });
			} else {
				form.append({ type: 'header', label: msg('file-usage') });
				namespaces = [];
				$.each(getPref('unlinkNamespaces'), (k, v) => {
					namespaces.push(v === '0' ? msg('blanknamespace') : mw.config.get('wgFormattedNamespaces')[v]);
				});
				form.append({
					type: 'div',
					label: msg('selected-namespaces', namespaces),
					tooltip: msg('change-twpref'),
				});
				if (response['query-continue'] && response['query-continue'].imageusage) {
					form.append({
						type: 'div',
						label: msg('first-n-files', list.length),
					});
				}
				form.append({
					type: 'button',
					label: msg('select-all'),
					event: (e) => {
						$(Morebits.quickForm.getElements(e.target.form, 'imageusage')).prop('checked', true);
					},
				});
				form.append({
					type: 'button',
					label: msg('deselect-all'),
					event: (e) => {
						$(Morebits.quickForm.getElements(e.target.form, 'imageusage')).prop('checked', false);
					},
				});
				form.append({
					type: 'checkbox',
					name: 'imageusage',
					shiftClickSupport: true,
					list: list,
				});
				havecontent = true;
			}
		}

		var backlinks = response.query.backlinks.sort(sortByNamespace);
		if (backlinks.length > 0) {
			list = [];
			for (i = 0; i < backlinks.length; ++i) {
				// Label made by Twinkle.generateBatchPageLinks
				list.push({ label: '', value: backlinks[i].title, checked: true });
			}
			form.append({ type: 'header', label: msg('backlinks') });
			namespaces = [];
			$.each(getPref('unlinkNamespaces'), (k, v) => {
				namespaces.push(v === '0' ? msg('blanknamespace') : mw.config.get('wgFormattedNamespaces')[v]);
			});
			form.append({
				type: 'div',
				label: msg('selected-namespaces', namespaces),
				tooltip: msg('change-twpref'),
			});
			if (response['query-continue'] && response['query-continue'].backlinks) {
				form.append({
					type: 'div',
					label: msg('first-n-links', list.length),
				});
			}
			form.append({
				type: 'button',
				label: msg('select-all'),
				event: (e) => $(Morebits.quickForm.getElements(e.target.form, 'backlinks')).prop('checked', true),
			});
			form.append({
				type: 'button',
				label: msg('deselect-all'),
				event: (e) => $(Morebits.quickForm.getElements(e.target.form, 'backlinks')).prop('checked', false),
			});
			form.append({
				type: 'checkbox',
				name: 'backlinks',
				shiftClickSupport: true,
				list: list,
			});
			havecontent = true;
		} else {
			form.append({ type: 'div', label: msg('no-backlinks') });
		}

		if (havecontent) {
			form.append({ type: 'submit' });
		}

		var result = form.render();
		Window.setContent(result);

		Morebits.quickForm.getElements(result, 'backlinks').forEach(generateBatchPageLinks);
		Morebits.quickForm.getElements(result, 'imageusage').forEach(generateBatchPageLinks);
	}

	unlinkBacklinks(pageobj: Page) {
		var oldtext = pageobj.getPageText();
		var params = pageobj.getCallbackParameters();
		var wikiPage = new Morebits.wikitext.page(oldtext);

		var errors = { backlink: false, fileusage: false };
		var text;

		// remove image usages
		if (params.doImageusage) {
			text = wikiPage.commentOutImage(mw.config.get('wgTitle'), msg('commented-out')).getText();
			// did we actually make any changes?
			if (text !== oldtext) {
				oldtext = text;
			} else {
				errors.fileusage = true;
			}
		}

		// remove backlinks
		if (params.doBacklinks) {
			text = wikiPage.removeLink(Morebits.pageNameNorm).getText();
			// did we actually make any changes?
			if (text === oldtext) {
				errors.backlink = true;
			}
		}

		if (errors.backlink || errors.fileusage) {
			// nothing to do!
			pageobj
				.getStatusElement()
				.error(
					errors.backlink
						? errors.fileusage
							? msg('no-links-files-found')
							: msg('no-links-found')
						: msg('no-files-found')
				);
			params.unlinker.workerFailure(pageobj);
			return;
		}

		pageobj.setPageText(text);
		pageobj.setEditSummary(
			(params.doBacklinks
				? params.doImageusage
					? msg('summary-links-files', Morebits.pageNameNorm)
					: msg('summary-links', Morebits.pageNameNorm)
				: msg('summary-files', Morebits.pageNameNorm)) +
				msg('colon-separator') +
				params.reason
		);
		pageobj.setCreateOption('nocreate');
		pageobj.save().then(params.unlinker.workerSuccess, params.unlinker.workerFailure);
	}
}
