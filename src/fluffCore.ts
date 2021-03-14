import { Twinkle, TwinkleModule } from './twinkle';
import { msg } from './messenger';

class Fluff extends TwinkleModule {
	moduleName = 'fluff';
	static moduleName = 'fluff';

	// A list of usernames, usually only bots, that vandalism revert is jumped
	// over; that is, if vandalism revert was chosen on such username, then its
	// target is on the revision before.  This is for handling quick bots that
	// makes edits seconds after the original edit is made.  This only affects
	// vandalism rollback; for good faith rollback, it will stop, indicating a bot
	// has no faith, and for normal rollback, it will rollback that edit.
	trustedBots: string[];

	skipTalk = null;
	rollbackInPlace = null;

	// String to insert when a username is hidden
	hiddenName: string;

	flaggedRevsEnabled = !!mw.loader.moduleRegistry['ext.flaggedRevs.basic'];

	// Consolidated construction of fluff links
	linkBuilder = {
		spanTag: (color, content) => {
			var span = document.createElement('span');
			span.style.color = color;
			span.appendChild(document.createTextNode(content));
			return span;
		},

		buildLink: (color, text) => {
			var link = document.createElement('a');
			link.appendChild(this.linkBuilder.spanTag('Black', '['));
			link.appendChild(this.linkBuilder.spanTag(color, text));
			link.appendChild(this.linkBuilder.spanTag('Black', ']'));
			link.href = '#';
			return link;
		},

		/**
		 * @param {string} [vandal=null] - Username of the editor being reverted
		 * Provide a falsey value if the username is hidden, defaults to null
		 * @param {boolean} inline - True to create two links in a span, false
		 * to create three links in a div (optional)
		 * @param {number|string} [rev=wgCurRevisionId] - Revision ID being reverted (optional)
		 * @param {string} [page=wgPageName] - Page being reverted (optional)
		 */
		rollbackLinks: (vandal, inline = false, rev?, page?) => {
			vandal = vandal || null;

			var elem = inline ? 'span' : 'div';
			var revNode = document.createElement(elem);

			rev = parseInt(rev, 10);
			if (rev) {
				revNode.setAttribute('id', 'tw-revert' + rev);
			} else {
				revNode.setAttribute('id', 'tw-revert');
			}

			var normNode = document.createElement('strong');
			var vandNode = document.createElement('strong');

			var normLink = this.linkBuilder.buildLink('SteelBlue', msg('link-rollback'));
			var vandLink = this.linkBuilder.buildLink('Red', msg('link-vandalism'));

			$(normLink).click(() => {
				this.revert('norm', vandal, rev, page);
				this.disableLinks(revNode);
			});
			$(vandLink).click(() => {
				this.revert('vand', vandal, rev, page);
				this.disableLinks(revNode);
			});

			vandNode.appendChild(vandLink);
			normNode.appendChild(normLink);

			var separator = inline ? ' ' : ' || ';

			if (!inline) {
				var agfNode = document.createElement('strong');
				var agfLink = this.linkBuilder.buildLink('DarkOliveGreen', msg('link-goodfaith-rollback'));
				$(agfLink).click(() => {
					this.revert('agf', vandal, rev, page);
					// this.disableLinks(revNode); // rollbackInPlace not relevant for any inline situations
				});
				agfNode.appendChild(agfLink);
				revNode.appendChild(agfNode);
			}
			revNode.appendChild(document.createTextNode(separator));
			revNode.appendChild(normNode);
			revNode.appendChild(document.createTextNode(separator));
			revNode.appendChild(vandNode);

			return revNode;
		},

		// Build [restore this revision] links
		restoreThisRevisionLink: (revisionRef, inline = false) => {
			// If not a specific revision number, should be wgDiffNewId/wgDiffOldId/wgRevisionId
			revisionRef = typeof revisionRef === 'number' ? revisionRef : mw.config.get(revisionRef);

			var elem = inline ? 'span' : 'div';
			var revertToRevisionNode = document.createElement(elem);

			revertToRevisionNode.setAttribute('id', 'tw-revert-to-' + revisionRef);
			revertToRevisionNode.style.fontWeight = 'bold';

			var revertToRevisionLink = this.linkBuilder.buildLink('SaddleBrown', msg('restore-revision'));
			$(revertToRevisionLink).click(() => {
				this.revertToRevision(revisionRef);
			});

			if (inline) {
				revertToRevisionNode.appendChild(document.createTextNode(' '));
			}
			revertToRevisionNode.appendChild(revertToRevisionLink);
			return revertToRevisionNode;
		},
	};
	addLinks = {
		contributions: () => {
			// $('sp-contributions-footer-anon-range') relies on the fmbox
			// id in [[MediaWiki:Sp-contributions-footer-anon-range]] and
			// is used to show rollback/vandalism links for IP ranges
			var isRange = !!$('#sp-contributions-footer-anon-range')[0];
			if (mw.config.exists('wgRelevantUserName') || isRange) {
				// Get the username these contributions are for
				var username = mw.config.get('wgRelevantUserName');
				if (
					Twinkle.getPref('showRollbackLinks').indexOf('contribs') !== -1 ||
					(mw.config.get('wgUserName') !== username && Twinkle.getPref('showRollbackLinks').indexOf('others') !== -1) ||
					(mw.config.get('wgUserName') === username && Twinkle.getPref('showRollbackLinks').indexOf('mine') !== -1)
				) {
					var $list = $('#mw-content-text').find('ul li:has(span.mw-uctop):has(.mw-changeslist-diff)');

					$list.each((key, current) => {
						// revid is also available in the href of both
						// .mw-changeslist-date or .mw-changeslist-diff
						var page = $(current).find('.mw-contributions-title').text();

						// Get username for IP ranges (wgRelevantUserName is null)
						if (isRange) {
							// The :not is possibly unnecessary, as it appears that
							// .mw-userlink is simply not present if the username is hidden
							username = $(current).find('.mw-userlink:not(.history-deleted)').text();
						}

						// It's unlikely, but we can't easily check for revdel'd usernames
						// since only a strong element is provided, with no easy selector [[phab:T255903]]
						current.appendChild(this.linkBuilder.rollbackLinks(username, true, current.dataset.mwRevid, page));
					});
				}
			}
		},

		recentchanges: () => {
			if (Twinkle.getPref('showRollbackLinks').indexOf('recent') !== -1) {
				// Latest and revertable (not page creations, logs, categorizations, etc.)
				var $list = $('.mw-changeslist .mw-changeslist-last.mw-changeslist-src-mw-edit');
				// Exclude top-level header if "group changes" preference is used
				// and find only individual lines or nested lines
				$list = $list
					.not('.mw-rcfilters-ui-highlights-enhanced-toplevel')
					.find('.mw-changeslist-line-inner, td.mw-enhanced-rc-nested');

				$list.each((key, current) => {
					// The :not is possibly unnecessary, as it appears that
					// .mw-userlink is simply not present if the username is hidden
					var vandal = $(current).find('.mw-userlink:not(.history-deleted)').text();
					var href = $(current).find('.mw-changeslist-diff').attr('href');
					var rev = mw.util.getParamValue('diff', href);
					var page = current.dataset.targetPage;
					current.appendChild(this.linkBuilder.rollbackLinks(vandal, true, rev, page));
				});
			}
		},

		history: () => {
			if (Twinkle.getPref('showRollbackLinks').indexOf('history') !== -1) {
				// All revs
				var histList = $('#pagehistory li').toArray();

				// On first page of results, so add revert/rollback
				// links to the top revision
				if (!$('.mw-firstlink').length) {
					var first = histList.shift();
					var vandal = $(first).find('.mw-userlink:not(.history-deleted)').text();

					// Check for first username different than the top user,
					// only apply rollback links if/when found
					// for faster than every
					for (var i = 0; i < histList.length; i++) {
						if ($(histList[i]).find('.mw-userlink').text() !== vandal) {
							first.appendChild(this.linkBuilder.rollbackLinks(vandal, true));
							break;
						}
					}
				}

				// oldid
				histList.forEach((rev) => {
					// From restoreThisRevision, non-transferable
					// If the text has been revdel'd, it gets wrapped in a span with .history-deleted,
					// and href will be undefined (and thus oldid is NaN)
					var href = (rev.querySelector('.mw-changeslist-date') as HTMLAnchorElement).href;
					var oldid = parseInt(mw.util.getParamValue('oldid', href), 10);
					if (!isNaN(oldid)) {
						rev.appendChild(this.linkBuilder.restoreThisRevisionLink(oldid, true));
					}
				});
			}
		},

		diff: () => {
			// Autofill user talk links on diffs with vanarticle for easy warning, but don't autowarn
			var warnFromTalk = (xtitle) => {
				var talkLink = $('#mw-diff-' + xtitle + '2 .mw-usertoollinks a').first();
				if (talkLink.length) {
					var extraParams = 'vanarticle=' + mw.util.rawurlencode(Morebits.pageNameNorm) + '&' + 'noautowarn=true';
					// diffIDs for vanarticlerevid
					extraParams += '&vanarticlerevid=';
					extraParams += xtitle === 'otitle' ? mw.config.get('wgDiffOldId') : mw.config.get('wgDiffNewId');

					var href = talkLink.attr('href');
					if (href.indexOf('?') === -1) {
						talkLink.attr('href', href + '?' + extraParams);
					} else {
						talkLink.attr('href', href + '&' + extraParams);
					}
				}
			};

			// Older revision
			warnFromTalk('otitle'); // Add quick-warn link to user talk link
			// Don't load if there's a single revision or weird diff (cur on latest)
			if (mw.config.get('wgDiffOldId') && mw.config.get('wgDiffOldId') !== mw.config.get('wgDiffNewId')) {
				// Add a [restore this revision] link to the older revision
				var oldTitle = document.getElementById('mw-diff-otitle1').parentNode;
				oldTitle.insertBefore(this.linkBuilder.restoreThisRevisionLink('wgDiffOldId'), oldTitle.firstChild);
			}

			// Newer revision
			warnFromTalk('ntitle'); // Add quick-warn link to user talk link
			// Add either restore or rollback links to the newer revision
			// Don't show if there's a single revision or weird diff (prev on first)
			if (document.getElementById('differences-nextlink')) {
				// Not latest revision, add [restore this revision] link to newer revision
				var newTitle = document.getElementById('mw-diff-ntitle1').parentNode;
				newTitle.insertBefore(this.linkBuilder.restoreThisRevisionLink('wgDiffNewId'), newTitle.firstChild);
			} else if (
				Twinkle.getPref('showRollbackLinks').indexOf('diff') !== -1 &&
				mw.config.get('wgDiffOldId') &&
				(mw.config.get('wgDiffOldId') !== mw.config.get('wgDiffNewId') ||
					document.getElementById('differences-prevlink'))
			) {
				// Normally .mw-userlink is a link, but if the
				// username is hidden, it will be a span with
				// .history-deleted as well. When a sysop views the
				// hidden content, the span contains the username in a
				// link element, which will *just* have
				// .mw-userlink. The below thus finds the first
				// instance of the class, which if hidden is the span
				// and thus text returns undefined. Technically, this
				// is a place where sysops *could* have more
				// information available to them (as above, via
				// &unhide=1), since the username will be available by
				// checking a.mw-userlink instead, but revert() will
				// need reworking around userHidden
				var vandal = $('#mw-diff-ntitle2').find('.mw-userlink')[0].textContent;
				var ntitle = document.getElementById('mw-diff-ntitle1').parentNode;

				ntitle.insertBefore(this.linkBuilder.rollbackLinks(vandal), ntitle.firstChild);
			}
		},

		oldid: () => {
			// Add a [restore this revision] link on old revisions
			var title = document.getElementById('mw-revision-info').parentNode;
			title.insertBefore(this.linkBuilder.restoreThisRevisionLink('wgRevisionId'), title.firstChild);
		},
	};

	disableLinks(parentNode) {
		// Array.from not available in IE11 :(
		$(parentNode)
			.children()
			.each((_ix, node) => {
				node.innerHTML = node.textContent; // Feels like cheating
				$(node).css('font-weight', 'normal').css('color', 'darkgray');
			});
	}

	revert(type: 'vand' | 'norm' | 'agf', vandal: string, rev: number, page?: string) {
		if (mw.util.isIPv6Address(vandal)) {
			vandal = Morebits.ip.sanitizeIPv6(vandal);
		}

		var pagename = page || mw.config.get('wgPageName');
		var revid = rev || mw.config.get('wgCurRevisionId');

		if (this.rollbackInPlace) {
			var notifyStatus = document.createElement('span');
			mw.notify(notifyStatus, {
				autoHide: false,
				title: 'Rollback on ' + page,
				tag: 'twinklefluff_' + rev, // Shouldn't be necessary given disableLink
			});
			Morebits.status.init(notifyStatus);
		} else {
			Morebits.status.init(document.getElementById('mw-content-text'));
			$('#catlinks').remove();
		}

		var params = {
			type: type,
			user: vandal,
			userHidden: !vandal, // Keep track of whether the username was hidden
			pagename: pagename,
			revid: revid,
		};

		// Largely recapitulates Morebits.wiki.page.load, but we want to
		// process multiple revisions as well as discover flagged status
		var query = {
			action: 'query',
			prop: ['info', 'revisions'].concat(this.flaggedRevsEnabled ? 'flagged' : []),
			titles: pagename,
			inprop: 'watched',
			intestactions: 'edit',
			rvlimit: Twinkle.getPref('revertMaxRevisions'),
			rvprop: ['ids', 'timestamp', 'user'],
			curtimestamp: '',
			meta: 'tokens',
			type: 'csrf',
			format: 'json',
		};
		var wikipedia_api = new Morebits.wiki.api(msg('fetching-data'), query);
		wikipedia_api.params = params;
		wikipedia_api.post().then((apiobj) => this.callbacks.main(apiobj));
	}

	revertToRevision(oldrev) {
		Morebits.status.init(document.getElementById('mw-content-text'));

		// This is only here because we want the fancy edit summary from
		// this.formatSummary, so we need to load the revision user
		// before reverting.  If not for that, we could just skip loading.
		var revertPage = new Morebits.wiki.page(mw.config.get('wgPageName'), msg('saving-reverted'));
		revertPage.setOldID(oldrev);
		revertPage.load(this.callbacks.toRevision);
	}

	callbacks = {
		toRevision: (pageobj) => {
			var optional_summary = prompt(msg('prompt-reason-restore'), ''); // padded out to widen prompt in Firefox
			if (optional_summary === null) {
				pageobj.getStatusElement().error(msg('user-aborted'));
				return;
			}

			var summary = this.formatSummary(
				msg('restore-summary', pageobj.getRevisionID()),
				pageobj.getRevisionUser(),
				optional_summary
			);

			pageobj.setChangeTags(Twinkle.changeTags);
			pageobj.setEditSummary(summary);
			if (Twinkle.getPref('watchRevertedPages').indexOf('torev') !== -1) {
				pageobj.setWatchlist(Twinkle.getPref('watchRevertedExpiry'));
			}
			if (Twinkle.getPref('markRevertedPagesAsMinor').indexOf('torev') !== -1) {
				pageobj.setMinorEdit(true);
			}

			Morebits.wiki.actionCompleted.redirect = pageobj.getPageName();
			Morebits.wiki.actionCompleted.notice = msg('reversion-complete');

			pageobj.revert();
		},
		main: (apiobj) => {
			var page = apiobj.getResponse().query.pages[0];
			if (!page.actions.edit) {
				apiobj.statelem.error(msg('cant-edit-protected'));
				return;
			}

			var statelem = apiobj.statelem;
			var params = apiobj.params;

			var lastrevid = parseInt(page.lastrevid, 10);
			var revs = page.revisions;
			if (revs.length < 1) {
				statelem.error(msg('no-revisions'));
				return;
			}
			var top = revs[0];
			var lastuser = top.user;

			// Should be handled by the API, but nice to quit early
			if (lastrevid < params.revid) {
				Morebits.status.error('Error', msg('bad-revid', lastrevid));
				return;
			}

			// Used for user-facing alerts, messages, etc., not edits or summaries
			var userNorm = params.user || this.hiddenName;
			var index = 1;
			if (params.revid !== lastrevid) {
				Morebits.status.warn('Warning', msg('revid-mismatch', lastrevid, params.revid));
				// Treat ipv6 users on same 64 block as the same
				if (
					lastuser === params.user ||
					(mw.util.isIPv6Address(params.user) && Morebits.ip.get64(lastuser) === Morebits.ip.get64(params.user))
				) {
					switch (params.type) {
						case 'vand':
							if (lastuser !== params.user) {
								Morebits.status.info('Info', msg('latest-rev-same-64', userNorm));
							} else {
								Morebits.status.info('Info', msg('latest-rev-same-user', userNorm));
							}
							break;
						case 'agf':
							Morebits.status.warn('Warning', msg('latest-rev-other-user-goodfaith', userNorm));
							return;
						default:
							Morebits.status.warn('Notice', msg('latest-rev-other-user', userNorm));
							return;
					}
				} else if (
					params.type === 'vand' &&
					// Okay to test on user since it will either fail or sysop will correctly access it
					// Besides, none of the trusted bots are going to be revdel'd
					this.trustedBots.indexOf(top.user) !== -1 &&
					revs.length > 1 &&
					revs[1].revid === params.revid
				) {
					Morebits.status.info('Info', msg('latest-rev-bot', lastuser));
					index = 2;
				} else {
					Morebits.status.error('Error', msg('latest-rev-reverted', lastuser));
					return;
				}
			} else {
				// Expected revision is the same, so the users must match;
				// this allows sysops to know whether the users are the same
				params.user = lastuser;
				userNorm = params.user || this.hiddenName;
			}

			if (this.trustedBots.indexOf(params.user) !== -1) {
				switch (params.type) {
					case 'vand':
						Morebits.status.info('Info', msg('bot-revert', userNorm));
						index = 2;
						params.user = revs[1].user;
						params.userHidden = !!revs[1].userhidden;
						break;
					case 'agf':
						Morebits.status.warn('Notice', msg('bot-revert-goodfaith', userNorm));
						return;
					case 'norm':
					/* falls through */
					default:
						var cont = confirm(msg('bot-revert-prompt'));
						if (cont) {
							Morebits.status.info('Info', msg('bot-revert-previous', userNorm));
							index = 2;
							params.user = revs[1].user;
							params.userHidden = !!revs[1].userhidden;
							userNorm = params.user || this.hiddenName;
						} else {
							Morebits.status.warn('Notice', msg('bot-revert-selected', userNorm));
						}
						break;
				}
			}
			var found = false;
			var count = 0;
			var seen64 = false;

			for (var i = index; i < revs.length; ++i) {
				++count;
				if (revs[i].user !== params.user) {
					// Treat ipv6 users on same 64 block as the same
					if (
						mw.util.isIPv6Address(revs[i].user) &&
						Morebits.ip.get64(revs[i].user) === Morebits.ip.get64(params.user)
					) {
						if (!seen64) {
							new Morebits.status('Note', msg('ipv6-same-user'));
							seen64 = true;
						}
						continue;
					}
					found = i;
					break;
				}
			}

			if (!found) {
				statelem.error(msg('no-previous-revision', userNorm, Twinkle.getPref('revertMaxRevisions')));
				return;
			}

			if (!count) {
				Morebits.status.error('Error', msg('no-edits-revert'));
				return;
			}

			var good_revision = revs[found];
			var userHasAlreadyConfirmedAction = false;
			if (params.type !== 'vand' && count > 1) {
				if (!confirm(msg('revert-multiple-prompt', userNorm, count))) {
					Morebits.status.info('Notice', msg('stopping'));
					return;
				}
				userHasAlreadyConfirmedAction = true;
			}

			params.count = count;

			params.goodid = good_revision.revid;
			params.gooduser = good_revision.user;
			params.gooduserHidden = !!good_revision.userhidden;

			statelem.status(
				msg('revision-age', params.goodid, count, params.gooduserHidden ? this.hiddenName : params.gooduser)
			);

			var summary, extra_summary;
			switch (params.type) {
				case 'agf':
					extra_summary = prompt(msg('summary-prompt'), ''); // padded out to widen prompt in Firefox
					if (extra_summary === null) {
						statelem.error(msg('user-aborted'));
						return;
					}
					userHasAlreadyConfirmedAction = true;

					summary = this.formatSummary(
						msg('goodfaith-summary'), // %USER% will be replaced by username
						params.userHidden ? null : params.user,
						extra_summary
					);
					break;

				case 'vand':
					summary = this.formatSummary(
						msg('vandalism-summary', params.count, params.gooduserHidden ? this.hiddenName : params.gooduser),
						params.userHidden ? null : params.user
					);
					break;

				case 'norm':
				/* falls through */
				default:
					if (Twinkle.getPref('offerReasonOnNormalRevert')) {
						extra_summary = prompt(msg('summary-prompt'), ''); // padded out to widen prompt in Firefox
						if (extra_summary === null) {
							statelem.error(msg('user-aborted'));
							return;
						}
						userHasAlreadyConfirmedAction = true;
					}

					summary = this.formatSummary(
						msg('normal-summary', params.count),
						params.userHidden ? null : params.user,
						extra_summary
					);
					break;
			}

			if (
				(Twinkle.getPref('confirmOnFluff') ||
					// Mobile user agent taken from [[en:MediaWiki:Gadget-confirmationRollback-mobile.js]]
					(Twinkle.getPref('confirmOnMobileFluff') &&
						/Android|webOS|iPhone|iPad|iPod|BlackBerry|Mobile|Opera Mini/i.test(navigator.userAgent))) &&
				!userHasAlreadyConfirmedAction &&
				!confirm(msg('revert-confirm'))
			) {
				statelem.error(msg('user-aborted'));
				return;
			}

			// Decide whether to notify the user on success
			if (
				!this.skipTalk &&
				Twinkle.getPref('openTalkPage').indexOf(params.type) !== -1 &&
				!params.userHidden &&
				mw.config.get('wgUserName') !== params.user
			) {
				params.notifyUser = true;
				// Pass along to the warn module
				params.vantimestamp = top.timestamp;
			}

			// figure out whether we need to/can review the edit
			if (
				this.flaggedRevsEnabled &&
				(Morebits.userIsInGroup('reviewer') || Morebits.userIsSysop) &&
				!!page.flagged &&
				page.flagged.stable_revid >= params.goodid &&
				!!page.flagged.pending_since
			) {
				params.reviewRevert = true;
				params.csrftoken = apiobj.getResponse().query.tokens.csrftoken;
			}

			var revertPage = new Morebits.wiki.page(params.pagename, msg('saving-reverted'));
			revertPage.setEditSummary(summary);
			revertPage.setChangeTags(Twinkle.changeTags);
			revertPage.setOldID(params.goodid);
			revertPage.setCallbackParameters(params);
			if (Twinkle.getPref('watchRevertedPages').indexOf(params.type) !== -1) {
				revertPage.setWatchlist(Twinkle.getPref('watchRevertedExpiry'));
			}
			if (Twinkle.getPref('markRevertedPagesAsMinor').indexOf(params.type) !== -1) {
				revertPage.setMinorEdit(true);
			}

			if (!this.rollbackInPlace) {
				Morebits.wiki.actionCompleted.redirect = params.pagename;
			}
			Morebits.wiki.actionCompleted.notice = msg('revert-complete');

			revertPage.revert(this.callbacks.complete);
		},

		// Only called from main, not from toRevision
		complete: (pageobj) => {
			var params = pageobj.getCallbackParameters();

			if (params.notifyUser && !params.userHidden) {
				Morebits.status.info('Info', msg('opening-talk', params.user));

				var windowQuery = {
					title: 'User talk:' + params.user,
					action: 'edit',
					preview: 'yes',
					vanarticle: params.pagename.replace(/_/g, ' '),
					vanarticlerevid: params.revid,
					vantimestamp: params.vantimestamp,
					vanarticlegoodrevid: params.goodid,
					type: params.type,
					count: params.count,
				};

				switch (Twinkle.getPref('userTalkPageMode')) {
					case 'tab':
						window.open(mw.util.getUrl('', windowQuery), '_blank');
						break;
					case 'blank':
						window.open(
							mw.util.getUrl('', windowQuery),
							'_blank',
							'location=no,toolbar=no,status=no,directories=no,scrollbars=yes,width=1200,height=800'
						);
						break;
					case 'window':
					/* falls through */
					default:
						window.open(
							mw.util.getUrl('', windowQuery),
							window.name === 'twinklewarnwindow' ? '_blank' : 'twinklewarnwindow',
							'location=no,toolbar=no,status=no,directories=no,scrollbars=yes,width=1200,height=800'
						);
						break;
				}
			}

			// review the revert, if needed
			if (params.reviewRevert) {
				var query = {
					action: 'review',
					revid: pageobj.getSaveResponse().edit.newrevid,
					token: params.csrftoken,
					comment: msg('pcreview-comment') + Twinkle.summaryAd, // until the below
					// 'tags': Twinkle.changeTags // flaggedrevs tag support: [[phab:T247721]]
				};
				var wikipedia_api = new Morebits.wiki.api(msg('pcreview-accepting'), query);
				wikipedia_api.post();
			}
		},
	};

	// Format a nicer edit summary than the default Morebits revert one, mainly by
	// including user contribs and talk links and appending a custom reason.
	// If builtInString contains the string "%USER%", it will be replaced
	// by an appropriate user link if a user name is provided
	formatSummary(builtInString: string, userName?: string, customString?: string) {
		var result = builtInString;

		// append user's custom reason
		if (customString) {
			result += ': ' + Morebits.string.toUpperCaseFirstChar(customString);
		}

		// find number of UTF-8 bytes the resulting string takes up, and possibly add
		// a contributions or contributions+talk link if it doesn't push the edit summary
		// over the 499-byte limit
		if (/%USER%/.test(builtInString)) {
			if (userName) {
				var resultLen = unescape(encodeURIComponent(result.replace('%USER%', ''))).length;
				var contribsLink = '[[Special:Contributions/' + userName + '|' + userName + ']]';
				var contribsLen = unescape(encodeURIComponent(contribsLink)).length;
				if (resultLen + contribsLen <= 499) {
					var talkLink = ' ([[User talk:' + userName + '|talk]])';
					if (resultLen + contribsLen + unescape(encodeURIComponent(talkLink)).length <= 499) {
						result = Morebits.string.safeReplace(result, '%USER%', contribsLink + talkLink);
					} else {
						result = Morebits.string.safeReplace(result, '%USER%', contribsLink);
					}
				} else {
					result = Morebits.string.safeReplace(result, '%USER%', userName);
				}
			} else {
				result = Morebits.string.safeReplace(result, '%USER%', this.hiddenName);
			}
		}

		return result;
	}

	constructor() {
		super();

		// Only proceed if the user can actually edit the page in question
		// (see #632 for contribs issue).  wgIsProbablyEditable should take
		// care of namespace/contentModel restrictions as well as explicit
		// protections; it won't take care of cascading or TitleBlacklist.
		if (mw.config.get('wgIsProbablyEditable')) {
			// wgDiffOldId included for clarity in if else loop [[phab:T214985]]
			if (mw.config.get('wgDiffNewId') || mw.config.get('wgDiffOldId')) {
				// Reload alongside the revision slider
				mw.hook('wikipage.diff').add(() => {
					this.addLinks.diff();
				});
			} else if (
				mw.config.get('wgAction') === 'view' &&
				mw.config.get('wgRevisionId') &&
				mw.config.get('wgCurRevisionId') !== mw.config.get('wgRevisionId')
			) {
				this.addLinks.oldid();
			} else if (mw.config.get('wgAction') === 'history' && mw.config.get('wgArticleId')) {
				this.addLinks.history();
			}
		} else if (mw.config.get('wgNamespaceNumber') === -1) {
			this.skipTalk = !Twinkle.getPref('openTalkPageOnAutoRevert');
			this.rollbackInPlace = Twinkle.getPref('rollbackInPlace');

			if (mw.config.get('wgCanonicalSpecialPageName') === 'Contributions') {
				this.addLinks.contributions();
			} else if (
				mw.config.get('wgCanonicalSpecialPageName') === 'Recentchanges' ||
				mw.config.get('wgCanonicalSpecialPageName') === 'Recentchangeslinked'
			) {
				// Reload with recent changes updates
				// structuredChangeFilters.ui.initialized is just on load
				mw.hook('wikipage.content').add((item) => {
					if (item.is('div')) {
						this.addLinks.recentchanges();
					}
				});
			}
		}
	}
}

export { Fluff as FluffCore };
