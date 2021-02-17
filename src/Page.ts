import { Twinkle } from './twinkle';

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
			this.setEditSummary = (summary) => {
				super.setEditSummary(summary + Twinkle.summaryAd);
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
			let origFunc = this[func].bind(this);
			this[func] = function (onSuccess, onFailure) {
				let def = $.Deferred();
				origFunc(
					() => {
						if (onSuccess) {
							onSuccess.call(
								this, // pass context as this, mostly needed everywhere
								this // pass first arg as this, only needed for fnAutoSave
								// which takes pageobj as argument
							);
						}
						def.resolve(this);
					},
					() => {
						if (onFailure) {
							onFailure.call(this, this); // same as above
						}
						def.reject(this);
					}
				);
				return def;
			};
		});
	}

	// The non-standard way of overriding the functions means we have to tell TS about it in some way.
	// Using ts-ignore here as there are no definitions to go along with the declarations, but TS does
	// take note of the new declaration.
	// @ts-ignore
	load(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	lookupCreation(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	save(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	append(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	prepend(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	newSection(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	deletePage(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	undeletePage(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	protect(): JQuery.Promise<Twinkle.page>;
	// @ts-ignore
	stabilize(): JQuery.Promise<Twinkle.page>;
}
