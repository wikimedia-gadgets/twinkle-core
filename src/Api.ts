import { Twinkle } from './twinkle';

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
