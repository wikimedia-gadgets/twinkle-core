import { Twinkle } from './twinkle';
import { ApiError } from './utils';

/**
 * Light but immensely hacky wrapper around Morebits.wiki.page that presets the change tags
 * and promisifies the core methods.
 */
export class Page extends Morebits.wiki.page {
	constructor(title: string, status?: string | Morebits.status) {
		super(title, status);

		// If changeTags is configured, apply it, otherwise override setEditSummary
		// so that it appends the summaryAd
		if (Twinkle.changeTags.length) {
			// checks out if changeTags is a non-empty string or a non-empty array
			this.setChangeTags(Twinkle.changeTags);
		} else {
			let setEditSummaryOriginal = this.setEditSummary.bind(this);
			this.setEditSummary = function (summary: string) {
				setEditSummaryOriginal(summary + Twinkle.summaryAd);
			};
		}

		// This is ugly, because Morebits.wiki.page uses an implementation pattern
		// that doesn't define any methods on Morebits.wiki.page.prototype.
		let functionsToPromisify = [
			'load',
			'lookupCreation',
			'save',
			'append',
			'prepend',
			'newSection',
			'deletePage',
			'undeletePage',
			'protect',
			'stabilize',
		];

		functionsToPromisify.forEach((func) => {
			// TODO: check return argument types
			let origFunc = this[func].bind(this);
			this[func] = function (onSuccess, onFailure) {
				let def = $.Deferred();
				origFunc(
					(arg) => {
						if (onSuccess) {
							onSuccess.call(
								this, // pass context as this, mostly needed everywhere
								this // pass first arg as this, only needed for fnAutoSave
								// which takes pageobj as argument
							);
						}

						// try to resolve with the api object
						def.resolve(arg instanceof Morebits.wiki.api ? arg : this);
					},
					(arg) => {
						if (onFailure) {
							onFailure.call(this, this); // same as above
						}
						if (arg instanceof Morebits.wiki.api) {
							var err = new ApiError(arg.getErrorCode() + ': ' + arg.getErrorText());
							err.code = arg.getErrorCode();
							err.info = arg.getErrorText();
							err.response = arg.getResponse();
							def.reject(err);
						} else {
							def.reject(new Error(arg));
						}
					}
				);
				return def;
			};
		});
	}
}

// The non-standard way of overriding the functions means we have to tell TS about it in some way.
export interface Page {
	load(): JQuery.Promise<Morebits.wiki.api>;

	lookupCreation(): JQuery.Promise<Morebits.wiki.api>;

	save(): JQuery.Promise<Morebits.wiki.api>;

	append(): JQuery.Promise<Morebits.wiki.api>;

	prepend(): JQuery.Promise<Morebits.wiki.api>;

	newSection(): JQuery.Promise<Morebits.wiki.api>;

	deletePage(): JQuery.Promise<Morebits.wiki.api>;

	undeletePage(): JQuery.Promise<Morebits.wiki.api>;

	protect(): JQuery.Promise<Morebits.wiki.api>;

	stabilize(): JQuery.Promise<Morebits.wiki.api>;
}
