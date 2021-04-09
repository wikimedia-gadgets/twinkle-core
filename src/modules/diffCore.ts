import { Api } from '../Api';
import { TwinkleModule } from '../twinkleModule';
import { addPortletLink } from '../portlet';
import { msg } from '../messenger';

/**
 * Diff module: shows a link to last edit on all pages.
 * On diff pages, shows a link to a diff of edits since your last edit,
 * and a diff of the version compared to the current version.
 *
 * Localisation: should work without any configuration.
 */
export class DiffCore extends TwinkleModule {
	static moduleName = 'Diff';

	constructor() {
		super();
		if (mw.config.get('wgNamespaceNumber') < 0 || !mw.config.get('wgArticleId')) {
			return;
		}

		addPortletLink(
			mw.util.getUrl(mw.config.get('wgPageName'), {
				diff: 'cur',
				oldid: 'prev',
			}),
			msg('diff-last'),
			'twinkle-lastdiff',
			msg('diff-last-tooltip')
		);

		// Show additional tabs only on diff pages
		if (!mw.util.getParamValue('diff')) {
			return;
		}

		addPortletLink(() => this.evaluate(false), msg('diff-since'), 'tw-since', msg('diff-since-tooltip'));

		addPortletLink(() => this.evaluate(true), msg('diff-sincemine'), 'tw-sincemine', msg('diff-sincemine-tooltip'));

		addPortletLink(
			mw.util.getUrl(mw.config.get('wgPageName'), {
				diff: 'cur',
				oldid: /oldid=(.+)/.exec($('#mw-diff-ntitle1').find('strong a').first().attr('href'))[1],
			}),
			msg('diff-current'),
			'tw-curdiff',
			msg('diff-current-tooltip')
		);
	}

	evaluate(me: boolean) {
		var user;
		if (me) {
			user = mw.config.get('wgUserName');
		} else {
			var node = document.getElementById('mw-diff-ntitle2');
			if (!node) {
				// nothing to do?
				return;
			}
			user = $(node).find('a').first().text();
		}
		Morebits.status.init(document.getElementById('mw-content-text'));
		var wikipedia_api = new Api('Grabbing data of initial contributor', {
			prop: 'revisions',
			action: 'query',
			titles: mw.config.get('wgPageName'),
			rvlimit: 1,
			rvprop: ['ids', 'user'],
			rvstartid: mw.config.get('wgCurRevisionId') - 1, // i.e. not the current one
			rvuser: user,
			format: 'json',
		});
		wikipedia_api.post().then((apiobj) => {
			var rev = apiobj.getResponse().query.pages[0].revisions;
			var revid = rev && rev[0].revid;

			if (!revid) {
				apiobj.getStatusElement().error(msg('diff-error', user));
				return;
			}
			window.location.href = mw.util.getUrl(mw.config.get('wgPageName'), {
				diff: mw.config.get('wgCurRevisionId'),
				oldid: revid,
			});
		});
		wikipedia_api.post();
	}
}
