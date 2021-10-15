import { Twinkle } from '../twinkle';
import { generateArrowLinks } from '../utils';
import { Dialog, footerLinks } from '../Dialog';
import { msg } from '../messenger';
import { TwinkleModule } from '../twinkleModule';
import { getPref } from '../Config';

/**
 * Module used for batch deletion of pages. Works in different ways on three
 * types of pages:
 * 1. If invoked from category, delete pages from the category
 * 2. If invoked from a regular page, delete pages linked from the page
 * 3. If invoked from a Special:PrefixIndex query page, delete pages in the result
 * The user can select which pages to delete in all cases, as well as choose to
 * delete all the talk pages and subpages, and unlink the pages being deleted.
 *
 * Localisation: Should work without any configuration.
 */
export class BatchDeleteCore extends TwinkleModule {
	moduleName = 'batchdelete';
	static moduleName = 'batchdelete';

	portletName = 'D-batch';
	portletId = 'twinkle-batchdelete';
	portletTooltip = 'Delete pages found in this category/on this page';
	windowTitle = 'Batch deletion';

	constructor() {
		super();

		if (
			Morebits.userIsSysop &&
			((mw.config.get('wgCurRevisionId') && mw.config.get('wgNamespaceNumber') > 0) ||
				mw.config.get('wgCanonicalSpecialPageName') === 'Prefixindex')
		) {
			this.addMenu();
		}
	}

	unlinkCache = {};

	pages: Record<string, any>;

	// Has the subpages list been loaded?
	subpagesLoaded: boolean;

	footerLinks: footerLinks;

	makeWindow() {
		this.subpagesLoaded = false;
		var Window = new Dialog(600, 400);
		Window.setTitle(this.windowTitle);
		Window.setFooterLinks(this.footerLinks);

		var form = new Morebits.quickForm(this.evaluate.bind(this));
		form.append({
			type: 'checkbox',
			list: [
				{
					label: msg('option-delete'),
					name: 'delete_page',
					value: 'delete',
					checked: true,
					subgroup: {
						type: 'checkbox',
						list: [
							{
								label: msg('option-talks'),
								name: 'delete_talk',
								value: 'delete_talk',
								checked: true,
							},
							{
								label: msg('option-redirects'),
								name: 'delete_redirects',
								value: 'delete_redirects',
								checked: true,
							},
							{
								label: msg('option-subpages'),
								name: 'delete_subpages',
								value: 'delete_subpages',
								checked: false,
								event: this.toggleSubpages.bind(this),
								subgroup: {
									type: 'checkbox',
									list: [
										{
											label: msg('option-subpage-talks'),
											name: 'delete_subpage_talks',
											value: 'delete_subpage_talks',
										},
										{
											label: msg('option-subpage-redirects'),
											name: 'delete_subpage_redirects',
											value: 'delete_subpage_redirects',
										},
										{
											label: msg('option-subpage-unlink'),
											name: 'unlink_subpages',
											value: 'unlink_subpages',
										},
									],
								},
							},
						],
					},
				},
				{
					label: msg('option-unlink'),
					name: 'unlink_page',
					value: 'unlink',
					checked: false,
				},
				{
					label: msg('option-unlink-file'),
					name: 'unlink_file',
					value: 'unlink_file',
					checked: true,
				},
			],
		});
		form.append({
			type: 'input',
			name: 'reason',
			label: msg('reason'),
			size: 60,
		});

		var query = {
			action: 'query',
			prop: ['revisions', 'info', 'imageinfo'],
			inprop: 'protection',
			rvprop: ['size', 'user'],
			format: 'json',
		};

		// On categories
		if (mw.config.get('wgNamespaceNumber') === 14) {
			$.extend(query, {
				generator: 'categorymembers',
				gcmtitle: mw.config.get('wgPageName'),
				gcmlimit: getPref('batchMax'),
			});

			// On Special:PrefixIndex
		} else if (mw.config.get('wgCanonicalSpecialPageName') === 'Prefixindex') {
			$.extend(query, {
				generator: 'allpages',
				gaplimit: getPref('batchMax'),
			});
			if (mw.util.getParamValue('prefix')) {
				$.extend(query, {
					gapnamespace: mw.util.getParamValue('namespace'),
					gapprefix: mw.util.getParamValue('prefix'),
				});
			} else {
				var pathSplit = decodeURIComponent(location.pathname).split('/');
				if (pathSplit.length < 3 || pathSplit[2] !== 'Special:PrefixIndex') {
					return;
				}
				var titleSplit = pathSplit[3].split(':');
				$.extend(query, { gapnamespace: mw.config.get('wgNamespaceIds')[titleSplit[0].toLowerCase()] });
				if (titleSplit.length < 2 || typeof query.gapnamespace === 'undefined') {
					$.extend(query, {
						gapnamespace: 0, // article namespace
						gapprefix: pathSplit.splice(3).join('/'),
					});
				} else {
					pathSplit = pathSplit.splice(4);
					pathSplit.splice(0, 0, titleSplit.splice(1).join(':'));
					$.extend(query, { gapprefix: pathSplit.join('/') });
				}
			}

			// On normal pages
		} else {
			$.extend(query, {
				generator: 'links',
				titles: mw.config.get('wgPageName'),
				gpllimit: getPref('batchMax'),
			});
		}

		var statusdiv = document.createElement('div');
		statusdiv.style.padding = '15px'; // just so it doesn't look broken
		Window.setContent(statusdiv);
		Morebits.status.init(statusdiv);
		Window.display();

		this.pages = {};

		var statelem = new Morebits.status(msg('fetching-list'));
		var wikipedia_api = new Morebits.wiki.api(
			msg('loading'),
			query,
			(apiobj) => {
				var response = apiobj.getResponse();
				var pages = (response.query && response.query.pages) || [];
				pages = pages.filter((page) => {
					return !page.missing && page.imagerepository !== 'shared';
				});
				// json formatversion=2 doesn't sort pages by namespace
				pages.sort((one, two) => {
					return one.ns - two.ns || (one.title > two.title ? 1 : -1);
				});
				pages.forEach((page) => {
					let metadata = this.getMetadata(page);
					let isProtected = page.protection.filter((pr) => {
						return pr.type === 'edit' && pr.level === 'sysop';
					}).length;

					var title = page.title;
					this.pages[title] = {
						label:
							title +
							(metadata.length
								? msg('word-separator') + msg('parentheses', metadata.join(msg('semicolon-separator')))
								: ''),
						value: title,
						checked: true,
						style: isProtected ? 'color: red' : '',
					};
				});

				var form = apiobj.params.form;
				form.append({ type: 'header', label: msg('pages-label') });
				form.append({
					type: 'button',
					label: msg('select-all'),
					event: () => {
						$(result)
							.find('input[name=pages]:not(:checked)')
							.each((_, e) => {
								e.click(); // check it, and invoke click event so that subgroup can be shown
							});

						// Check any unchecked subpages too
						$('input[name="pages.subpages"]').prop('checked', true);
					},
				});
				form.append({
					type: 'button',
					label: msg('deselect-all'),
					event: () => {
						$(result)
							.find('input[name=pages]:checked')
							.each((_, e) => {
								e.click(); // uncheck it, and invoke click event so that subgroup can be hidden
							});
					},
				});
				form.append({
					type: 'checkbox',
					name: 'pages',
					id: 'tw-dbatch-pages',
					shiftClickSupport: true,
					list: $.map(this.pages, (e) => {
						return e;
					}),
				});
				form.append({ type: 'submit' });

				var result = form.render();
				apiobj.params.Window.setContent(result);

				Morebits.quickForm.getElements(result, 'pages').forEach(generateArrowLinks);
			},
			statelem
		);

		wikipedia_api.params = { form: form, Window: Window };
		wikipedia_api.post();
	}

	generateNewPageList(form) {
		// Update the list of checked pages in this.pages object
		var elements = form.elements.pages;
		if (elements instanceof NodeList) {
			// if there are multiple pages
			for (var i = 0; i < elements.length; ++i) {
				// @ts-ignore
				this.pages[elements[i].value].checked = elements[i].checked;
			}
		} else if (elements instanceof HTMLInputElement) {
			// if there is just one page
			this.pages[elements.value].checked = elements.checked;
		}

		return new Morebits.quickForm.element({
			type: 'checkbox',
			name: 'pages',
			id: 'tw-dbatch-pages',
			shiftClickSupport: true,
			list: $.map(this.pages, (e) => {
				return e;
			}),
		}).render();
	}

	toggleSubpages(e) {
		var form = e.target.form;
		var newPageList;

		if (e.target.checked) {
			form.delete_subpage_redirects.checked = form.delete_redirects.checked;
			form.delete_subpage_talks.checked = form.delete_talk.checked;
			form.unlink_subpages.checked = form.unlink_page.checked;

			// If lists of subpages were already loaded once, they are
			// available without use of any API calls
			if (this.subpagesLoaded) {
				$.each(this.pages, (i, el) => {
					// Get back the subgroup from subgroup_, where we saved it
					if (el.subgroup === null && el.subgroup_) {
						el.subgroup = el.subgroup_;
					}
				});

				newPageList = this.generateNewPageList(form);
				$('#tw-dbatch-pages').replaceWith(newPageList);

				Morebits.quickForm.getElements(newPageList, 'pages').forEach(generateArrowLinks);
				Morebits.quickForm.getElements(newPageList, 'pages.subpages').forEach(generateArrowLinks);

				return;
			}

			// Proceed with API calls to get list of subpages
			var loadingText = '<strong id="dbatch-subpage-loading">' + msg('loading') + '</strong>';
			$(e.target).after(loadingText);

			var pages = $(form.pages)
				.map((i, el) => {
					return el.value;
				})
				.get();

			var subpageLister = new Morebits.batchOperation();
			subpageLister.setOption('chunkSize', getPref('batchChunks'));
			subpageLister.setPageList(pages);
			subpageLister.run(
				(pageName: string) => {
					var pageTitle = mw.Title.newFromText(pageName);

					// No need to look for subpages in main/file/mediawiki space
					if ([0, 6, 8].indexOf(pageTitle.namespace) > -1) {
						subpageLister.workerSuccess();
						return;
					}

					var wikipedia_api = new Morebits.wiki.api(
						'Getting list of subpages of ' + pageName,
						{
							action: 'query',
							prop: 'revisions|info|imageinfo',
							generator: 'allpages',
							rvprop: 'size',
							inprop: 'protection',
							gapprefix: pageTitle.title + '/',
							gapnamespace: pageTitle.namespace,
							gaplimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
							format: 'json',
						},
						(apiobj) => {
							var response = apiobj.getResponse();
							var pages = (response.query && response.query.pages) || [];
							var subpageList = [];
							// json formatversion=2 doesn't sort pages by namespace
							pages.sort((one, two) => {
								return one.ns - two.ns || (one.title > two.title ? 1 : -1);
							});
							pages.forEach((page) => {
								let metadata = this.getMetadata(page);
								let isProtected = page.protection.filter((pr) => {
									return pr.type === 'edit' && pr.level === 'sysop';
								}).length;

								var title = page.title;
								subpageList.push({
									label:
										title +
										(metadata.length
											? msg('word-separator') + msg('parentheses', metadata.join(msg('semicolon-separator')))
											: ''),
									value: title,
									checked: true,
									style: isProtected ? 'color: red' : '',
								});
							});
							if (subpageList.length) {
								var pageName = apiobj.params.pageNameFull;
								this.pages[pageName].subgroup = {
									type: 'checkbox',
									name: 'subpages',
									className: 'dbatch-subpages',
									shiftClickSupport: true,
									list: subpageList,
								};
							}
							subpageLister.workerSuccess();
						},
						null /* statusElement */,
						() => {
							subpageLister.workerFailure();
						}
					);
					wikipedia_api.params = { pageNameFull: pageName }; // Used in onSuccess()
					wikipedia_api.post();
				},
				() => {
					// List 'em on the interface

					newPageList = this.generateNewPageList(form);
					$('#tw-dbatch-pages').replaceWith(newPageList);

					Morebits.quickForm.getElements(newPageList, 'pages').forEach(generateArrowLinks);
					Morebits.quickForm.getElements(newPageList, 'pages.subpages').forEach(generateArrowLinks);

					this.subpagesLoaded = true;

					// Remove "Loading... " text
					$('#dbatch-subpage-loading').remove();
				}
			);
		} else if (!e.target.checked) {
			$.each(this.pages, (i, el) => {
				if (el.subgroup) {
					// Remove subgroup after saving its contents in subgroup_
					// so that it can be retrieved easily if user decides to
					// delete the subpages again
					el.subgroup_ = el.subgroup;
					el.subgroup = null;
				}
			});

			newPageList = this.generateNewPageList(form);
			$('#tw-dbatch-pages').replaceWith(newPageList);

			Morebits.quickForm.getElements(newPageList, 'pages').forEach(generateArrowLinks);
		}
	}

	/**
	 * Returns an array with a list of strings to be included with the page name.
	 * @param page
	 */
	getMetadata(page): string[] {
		return [];
	}

	evaluate(event) {
		Morebits.wiki.actionCompleted.notice = msg('complete');

		var form = event.target;

		var numProtected = $(Morebits.quickForm.getElements(form, 'pages')).filter(function (
			index,
			element: HTMLInputElement
		) {
			return element.checked && (element.nextElementSibling as HTMLLabelElement).style.color === 'red';
		}).length;
		if (numProtected > 0 && !confirm(msg('confirm-protected', numProtected))) {
			return;
		}

		var input = Morebits.quickForm.getInputData(form);

		if (!input.reason) {
			alert(msg('dbatch-give-reason'));
			return;
		}
		Morebits.simpleWindow.setButtonsEnabled(false);
		Morebits.status.init(form);
		if ((input.pages as string[]).length === 0) {
			Morebits.status.error(msg('error'), msg('dbatch-no-pages'));
			return;
		}

		var pageDeleter = new Morebits.batchOperation(input.delete_page ? msg('deleting') : msg('starting'));
		pageDeleter.setOption('chunkSize', getPref('batchChunks'));
		// we only need the initial status lines if we're deleting the pages in the pages array
		pageDeleter.setOption('preserveIndividualStatusLines', input.delete_page as boolean);
		pageDeleter.setPageList(input.pages as string[]);
		pageDeleter.run(
			function (pageName: string) {
				var params = {
					page: pageName,
					delete_page: input.delete_page,
					delete_talk: input.delete_talk,
					delete_redirects: input.delete_redirects,
					unlink_page: input.unlink_page,
					unlink_file: input.unlink_file && new RegExp('^' + Morebits.namespaceRegex(6) + ':', 'i').test(pageName),
					reason: input.reason,
					pageDeleter: pageDeleter,
				};

				var wikipedia_page = new Morebits.wiki.page(pageName, msg('deleting-page', pageName));
				wikipedia_page.setCallbackParameters(params);
				if (input.delete_page) {
					wikipedia_page.setEditSummary(input.reason as string);
					wikipedia_page.setChangeTags(Twinkle.changeTags);
					wikipedia_page.suppressProtectWarning();
					wikipedia_page.deletePage(this.callbacks.doExtras, pageDeleter.workerFailure);
				} else {
					this.callbacks.doExtras(wikipedia_page);
				}
			}.bind(this),
			function () {
				if (input.delete_subpages && input.subpages) {
					var subpageDeleter = new Morebits.batchOperation(msg('deleting-subpages'));
					subpageDeleter.setOption('chunkSize', getPref('batchChunks'));
					subpageDeleter.setOption('preserveIndividualStatusLines', true);
					subpageDeleter.setPageList(input.subpages as string[]);
					subpageDeleter.run((pageName: string) => {
						var params = {
							page: pageName,
							delete_page: true,
							delete_talk: input.delete_subpage_talks,
							delete_redirects: input.delete_subpage_redirects,
							unlink_page: input.unlink_subpages,
							unlink_file: false,
							reason: input.reason,
							pageDeleter: subpageDeleter,
						};

						var wikipedia_page = new Morebits.wiki.page(pageName, msg('deleting-subpage', pageName));
						wikipedia_page.setCallbackParameters(params);
						wikipedia_page.setEditSummary(input.reason as string);
						wikipedia_page.setChangeTags(Twinkle.changeTags);
						wikipedia_page.suppressProtectWarning();
						wikipedia_page.deletePage(this.callbacks.doExtras, pageDeleter.workerFailure);
					});
				}
			}.bind(this)
		);
	}

	callbacks = {
		// this stupid parameter name is a temporary thing until I implement an overhaul
		// of Morebits.wiki.* callback parameters
		doExtras: (thingWithParameters) => {
			var params = thingWithParameters.parent
				? thingWithParameters.parent.getCallbackParameters()
				: thingWithParameters.getCallbackParameters();
			// the initial batch operation's job is to delete the page, and that has
			// succeeded by now
			params.pageDeleter.workerSuccess(thingWithParameters);

			var query, wikipedia_api;

			if (params.unlink_page) {
				this.unlinkCache = {};
				query = {
					action: 'query',
					list: 'backlinks',
					blfilterredir: 'nonredirects',
					blnamespace: [0, 100], // main space and portal space only
					bltitle: params.page,
					bllimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
					format: 'json',
				};
				wikipedia_api = new Morebits.wiki.api(msg('fetching-backlinks'), query, this.callbacks.unlinkBacklinksMain);
				wikipedia_api.params = params;
				wikipedia_api.post();
			}

			if (params.unlink_file) {
				query = {
					action: 'query',
					list: 'imageusage',
					iutitle: params.page,
					iulimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
					format: 'json',
				};
				wikipedia_api = new Morebits.wiki.api(
					msg('fetching-filelinks'),
					query,
					this.callbacks.unlinkImageInstancesMain
				);
				wikipedia_api.params = params;
				wikipedia_api.post();
			}

			if (params.delete_page) {
				if (params.delete_redirects) {
					query = {
						action: 'query',
						titles: params.page,
						prop: 'redirects',
						rdlimit: 'max', // 500 is max for normal users, 5000 for bots and sysops
						format: 'json',
					};
					wikipedia_api = new Morebits.wiki.api(msg('fetching-redirects'), query, this.callbacks.deleteRedirectsMain);
					wikipedia_api.params = params;
					wikipedia_api.post();
				}
				if (params.delete_talk) {
					var pageTitle = mw.Title.newFromText(params.page);
					if (pageTitle && pageTitle.namespace % 2 === 0 && pageTitle.namespace !== 2) {
						pageTitle.namespace++; // now pageTitle is the talk page title!
						query = {
							action: 'query',
							titles: pageTitle.toText(),
							format: 'json',
						};
						wikipedia_api = new Morebits.wiki.api(msg('check-talk'), query, this.callbacks.deleteTalk);
						wikipedia_api.params = params;
						wikipedia_api.params.talkPage = pageTitle.toText();
						wikipedia_api.post();
					}
				}
			}
		},
		deleteRedirectsMain: (apiobj) => {
			var response = apiobj.getResponse();
			var pages = response.query.pages[0].redirects || [];
			pages = pages.map((redirect) => {
				return redirect.title;
			});
			if (!pages.length) {
				return;
			}

			var redirectDeleter = new Morebits.batchOperation(msg('deleting-redirects', apiobj.params.page));
			redirectDeleter.setOption('chunkSize', getPref('batchChunks'));
			redirectDeleter.setPageList(pages);
			redirectDeleter.run((pageName: string) => {
				var wikipedia_page = new Morebits.wiki.page(pageName, 'Deleting ' + pageName);
				wikipedia_page.setEditSummary(msg('delete-redirect-summary', apiobj.params.page));
				wikipedia_page.setChangeTags(Twinkle.changeTags);
				wikipedia_page.deletePage(redirectDeleter.workerSuccess, redirectDeleter.workerFailure);
			});
		},
		deleteTalk: (apiobj) => {
			var response = apiobj.getResponse();

			// no talk page; forget about it
			if (response.query.pages[0].missing) {
				return;
			}

			var page = new Morebits.wiki.page(apiobj.params.talkPage, msg('deleting-talk', apiobj.params.page));
			page.setEditSummary(msg('delete-talk-summary', apiobj.params.page));
			page.setChangeTags(Twinkle.changeTags);
			page.deletePage();
		},
		unlinkBacklinksMain: (apiobj) => {
			var response = apiobj.getResponse();
			var pages = response.query.backlinks || [];
			pages = pages.map((page) => {
				return page.title;
			});
			if (!pages.length) {
				return;
			}

			var unlinker = new Morebits.batchOperation(msg('unlink-page', apiobj.params.page));
			unlinker.setOption('chunkSize', getPref('batchChunks'));
			unlinker.setPageList(pages);
			unlinker.run((pageName: string) => {
				var wikipedia_page = new Morebits.wiki.page(pageName, msg('unlink-on', pageName));
				var params = $.extend({}, apiobj.params);
				params.title = pageName;
				params.unlinker = unlinker;
				wikipedia_page.setCallbackParameters(params);
				wikipedia_page.load(this.callbacks.unlinkBacklinks);
			});
		},
		unlinkBacklinks: (pageobj) => {
			var params = pageobj.getCallbackParameters();
			if (!pageobj.exists()) {
				// we probably just deleted it, as a recursive backlink
				params.unlinker.workerSuccess(pageobj);
				return;
			}

			var text;
			if (params.title in this.unlinkCache) {
				text = this.unlinkCache[params.title];
			} else {
				text = pageobj.getPageText();
			}
			var old_text = text;
			var wikiPage = new Morebits.wikitext.page(text);
			text = wikiPage.removeLink(params.page).getText();

			this.unlinkCache[params.title] = text;
			if (text === old_text) {
				// Nothing to do, return
				params.unlinker.workerSuccess(pageobj);
				return;
			}
			pageobj.setEditSummary(msg('unlink-summary', params.page));
			pageobj.setChangeTags(Twinkle.changeTags);
			pageobj.setPageText(text);
			pageobj.setCreateOption('nocreate');
			pageobj.setMaxConflictRetries(10);
			pageobj.save(params.unlinker.workerSuccess, params.unlinker.workerFailure);
		},
		unlinkImageInstancesMain: (apiobj) => {
			var response = apiobj.getResponse();
			var pages = response.query.imageusage || [];
			pages = pages.map((page) => {
				return page.title;
			});
			if (!pages.length) {
				return;
			}

			var unlinker = new Morebits.batchOperation(msg('unlink-page', apiobj.params.page));
			unlinker.setOption('chunkSize', getPref('batchChunks'));
			unlinker.setPageList(pages);
			unlinker.run((pageName: string) => {
				var wikipedia_page = new Morebits.wiki.page(pageName, msg('unlink-img-on', pageName));
				var params = $.extend({}, apiobj.params);
				params.title = pageName;
				params.unlinker = unlinker;
				wikipedia_page.setCallbackParameters(params);
				wikipedia_page.load(this.callbacks.unlinkImageInstances);
			});
		},
		unlinkImageInstances: (pageobj) => {
			var params = pageobj.getCallbackParameters();
			if (!pageobj.exists()) {
				// we probably just deleted it, as a recursive backlink
				params.unlinker.workerSuccess(pageobj);
				return;
			}

			var image = params.page.replace(new RegExp('^' + Morebits.namespaceRegex(6) + ':'), '');
			var text;
			if (params.title in this.unlinkCache) {
				text = this.unlinkCache[params.title];
			} else {
				text = pageobj.getPageText();
			}
			var old_text = text;
			var wikiPage = new Morebits.wikitext.page(text);
			text = wikiPage.commentOutImage(image, msg('img-comment')).getText();

			this.unlinkCache[params.title] = text;
			if (text === old_text) {
				pageobj.getStatusElement().error('failed to unlink image ' + image + ' from ' + pageobj.getPageName());
				params.unlinker.workerFailure(pageobj);
				return;
			}
			pageobj.setEditSummary(msg('unlink-img-summary', image, params.reason));
			pageobj.setChangeTags(Twinkle.changeTags);
			pageobj.setPageText(text);
			pageobj.setCreateOption('nocreate');
			pageobj.setMaxConflictRetries(10);
			pageobj.save(params.unlinker.workerSuccess, params.unlinker.workerFailure);
		},
	};
}
