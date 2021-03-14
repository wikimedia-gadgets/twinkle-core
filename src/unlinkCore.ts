import { Twinkle, TwinkleModule } from './twinkle';
import { generateBatchPageLinks, sortByNamespace } from './utils';
import { Dialog } from './Dialog';
import { Page } from './Page';
import { Api } from './Api';

export class UnlinkCore extends TwinkleModule {
	moduleName = 'unlink';
	static moduleName = 'unlink';

	portletId = 'twinkle-unlink';
	portletName = 'Unlink';
	portletTooltip = 'Unlink backlinks';

	constructor() {
		super();
		if (
			mw.config.get('wgNamespaceNumber') < 0 ||
			mw.config.get('wgPageName') === 'Wikipedia:Sandbox' ||
			// Restrict to extended confirmed users (see #428)
			(!Morebits.userIsInGroup('extendedconfirmed') && !Morebits.userIsSysop)
		) {
			return;
		}
		this.addMenu();
	}

	// the parameter is used when invoking unlink from admin speedy
	makeWindow(presetReason?) {
		var fileSpace = mw.config.get('wgNamespaceNumber') === 6;

		var Window = new Dialog(600, 440);
		Window.setTitle('Unlink backlinks' + (fileSpace ? ' and file usages' : ''));
		Window.setFooterLinks(this.footerlinks);

		var form = new Morebits.quickForm(this.evaluate.bind(this));

		// prepend some documentation: files are commented out, while any
		// display text is preserved for links (otherwise the link itself is used)
		var linkTextBefore = Morebits.htmlNode(
			'code',
			'[[' + (fileSpace ? ':' : '') + Morebits.pageNameNorm + '|link text]]'
		);
		var linkTextAfter = Morebits.htmlNode('code', 'link text');
		var linkPlainBefore = Morebits.htmlNode('code', '[[' + Morebits.pageNameNorm + ']]');
		var linkPlainAfter;
		if (fileSpace) {
			linkPlainAfter = Morebits.htmlNode('code', '<!-- [[' + Morebits.pageNameNorm + ']] -->');
		} else {
			linkPlainAfter = Morebits.htmlNode('code', Morebits.pageNameNorm);
		}
		[linkTextBefore, linkTextAfter, linkPlainBefore, linkPlainAfter].forEach((node) => {
			node.style.fontFamily = 'monospace';
			node.style.fontStyle = 'normal';
		});

		form.append({
			type: 'div',
			style: 'margin-bottom: 0.5em',
			label: [
				'This tool allows you to unlink all incoming links ("backlinks") that point to this page' +
					(fileSpace ? ', and/or hide all inclusions of this file by wrapping them in <!-- --> comment markup' : '') +
					'. For instance, ',
				linkTextBefore,
				' would become ',
				linkTextAfter,
				' and ',
				linkPlainBefore,
				' would become ',
				linkPlainAfter,
				'. Use it with caution.',
			],
		});

		form.append({
			type: 'input',
			name: 'reason',
			label: 'Reason: ',
			value: presetReason ? presetReason : '',
			size: 60,
		});

		var query = {
			action: 'query',
			list: ['backlinks'],
			bltitle: mw.config.get('wgPageName'),
			bllimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
			blnamespace: Twinkle.getPref('unlinkNamespaces'),
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
		var wikipedia_api = new Api('Grabbing backlinks', query);
		wikipedia_api.params = { form: form, Window: Window, image: fileSpace };
		wikipedia_api.post().then(this.displayBacklinks);

		var root = document.createElement('div');
		root.style.padding = '15px'; // just so it doesn't look broken
		Morebits.status.init(root);
		wikipedia_api.getStatusElement().status('loading...');
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
			alert('You must specify a reason for unlinking.');
			return;
		}

		input.backlinks = input.backlinks || [];
		input.imageusage = input.imageusage || [];
		var pages = Morebits.array.uniq(input.backlinks.concat(input.imageusage));
		if (!pages.length) {
			alert('You must select at least one item to unlink.');
			return;
		}

		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(form);

		var unlinker = new Morebits.batchOperation(
			'Unlinking ' +
				(input.backlinks.length
					? 'backlinks' + (input.imageusage.length ? ' and instances of file usage' : '')
					: 'instances of file usage')
		);
		unlinker.setOption('preserveIndividualStatusLines', true);
		unlinker.setPageList(pages);
		var params = { reason: input.reason, unlinker: unlinker };
		unlinker.run((pageName: string) => {
			var wikipedia_page = new Page(pageName, 'Unlinking in page "' + pageName + '"');
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
			wikipedia_page.load().then(this.unlinkBacklinks);
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
				form.append({ type: 'div', label: 'No instances of file usage found.' });
			} else {
				form.append({ type: 'header', label: 'File usage' });
				namespaces = [];
				$.each(Twinkle.getPref('unlinkNamespaces'), (k, v) => {
					namespaces.push(v === '0' ? '(Article)' : mw.config.get('wgFormattedNamespaces')[v]);
				});
				form.append({
					type: 'div',
					label: 'Selected namespaces: ' + namespaces.join(', '),
					tooltip: 'You can change this with your Twinkle preferences, at [[WP:TWPREFS]]',
				});
				if (response['query-continue'] && response['query-continue'].imageusage) {
					form.append({
						type: 'div',
						label: 'First ' + mw.language.convertNumber(list.length) + ' file usages shown.',
					});
				}
				form.append({
					type: 'button',
					label: 'Select All',
					event: (e) => {
						$(Morebits.quickForm.getElements(e.target.form, 'imageusage')).prop('checked', true);
					},
				});
				form.append({
					type: 'button',
					label: 'Deselect All',
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
			form.append({ type: 'header', label: 'Backlinks' });
			namespaces = [];
			$.each(Twinkle.getPref('unlinkNamespaces'), (k, v) => {
				namespaces.push(v === '0' ? '(Article)' : mw.config.get('wgFormattedNamespaces')[v]);
			});
			form.append({
				type: 'div',
				label: 'Selected namespaces: ' + namespaces.join(', '),
				tooltip: 'You can change this with your Twinkle preferences, linked at the bottom of this Twinkle window',
			});
			if (response['query-continue'] && response['query-continue'].backlinks) {
				form.append({
					type: 'div',
					label: 'First ' + mw.language.convertNumber(list.length) + ' backlinks shown.',
				});
			}
			form.append({
				type: 'button',
				label: 'Select All',
				event: (e) => $(Morebits.quickForm.getElements(e.target.form, 'backlinks')).prop('checked', true),
			});
			form.append({
				type: 'button',
				label: 'Deselect All',
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
			form.append({ type: 'div', label: 'No backlinks found.' });
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

		var summaryText = '',
			warningString = false;
		var text;

		// remove image usages
		if (params.doImageusage) {
			text = wikiPage.commentOutImage(mw.config.get('wgTitle'), 'Commented out').getText();
			// did we actually make any changes?
			if (text === oldtext) {
				warningString = 'file usages';
			} else {
				summaryText = 'Commenting out use(s) of file';
				oldtext = text;
			}
		}

		// remove backlinks
		if (params.doBacklinks) {
			text = wikiPage.removeLink(Morebits.pageNameNorm).getText();
			// did we actually make any changes?
			if (text === oldtext) {
				warningString = warningString ? 'backlinks or file usages' : 'backlinks';
			} else {
				summaryText = (summaryText ? summaryText + ' / ' : '') + 'Removing link(s) to';
				oldtext = text;
			}
		}

		if (warningString) {
			// nothing to do!
			pageobj.getStatusElement().error("Didn't find any " + warningString + ' on the page.');
			params.unlinker.workerFailure(pageobj);
			return;
		}

		pageobj.setPageText(text);
		pageobj.setEditSummary(summaryText + ' "' + Morebits.pageNameNorm + '": ' + params.reason + '.');
		pageobj.setChangeTags(Twinkle.changeTags);
		pageobj.setCreateOption('nocreate');
		pageobj.save().then(params.unlinker.workerSuccess, params.unlinker.workerFailure);
	}
}
