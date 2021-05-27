import { Twinkle } from './twinkle';
import { language } from './messenger';

/**
 * Wrapper around Morebits.wiki.api that preset the commonly used
 * API parameters and sets the correct user agent
 */
export class Api extends Morebits.wiki.api {
	constructor(currentAction: string, query: Record<string, any>, statusElement?: Morebits.status) {
		query = $.extend(
			{
				action: 'query',
				format: 'json',
				formatversion: '2',
				uselang: language,
				errorlang: language,
				errorsuselocal: true,
				// tags isn't applicable for all API actions, it gives a warning but that's harmless
				tags: Twinkle.changeTags,
			},
			query
		);
		super(currentAction, query, null, statusElement, null);
	}

	post(ajaxParameters?: JQuery.AjaxSettings) {
		if (!ajaxParameters) {
			ajaxParameters = {};
		}
		if (!ajaxParameters.headers) {
			ajaxParameters.headers = {};
		}
		ajaxParameters.headers['Api-User-Agent'] = Twinkle.userAgent;
		return super.post(ajaxParameters);
	}
}

export let mwApi: mw.Api;

/**
 * Called from init(). Can't initialise at top level, since values of language,
 * Twinkle.changeTags and Twinkle.userAgent aren't final by that stage.
 * @private
 */
export function initialiseMwApi() {
	mwApi = new mw.Api({
		parameters: {
			action: 'query',
			format: 'json',
			formatversion: '2',
			uselang: language,
			errorlang: language,
			errorsuselocal: true,
			// tags isn't applicable for all API actions, it gives a warning but that's harmless
			tags: Twinkle.changeTags,
		},
		ajax: {
			headers: {
				'Api-User-Agent': Twinkle.userAgent,
			},
		},
	});
}
