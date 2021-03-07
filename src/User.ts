import { Twinkle } from './twinkle';
import {ApiError} from "./utils";

/**
 * Light but immensely hacky wrapper around Morebits.wiki.user that presets the
 * change tags and promisifies the core methods.
 */
export class User extends Morebits.wiki.user {
	constructor(userName: string, status?: string | Morebits.status) {
		super(userName, status);

		// If changeTags is configured, apply it, otherwise override setReason
		// so that it appends the summaryAd
		if (Twinkle.changeTags.length) {
			// checks out if changeTags is a non-empty string or a non-empty array
			this.setChangeTags(Twinkle.changeTags);
		} else {
			this.setReason = (summary) => {
				super.setReason(summary + Twinkle.summaryAd);
			};
		}

		// This is ugly, because Morebits.wiki.user uses an implementation pattern
		// that doesn't define any methods on Morebits.wiki.user.prototype.
		let functionsToPromisify = [
			'load',
			'block',
			'notify'
		];

		functionsToPromisify.forEach((func) => {
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
						def.resolve(arg instanceof Morebits.wiki.api
							? arg
							: this
						);
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
export interface User {
	load(): JQuery.Promise<Morebits.wiki.api>;
	block(): JQuery.Promise<Morebits.wiki.api>;
	notify(): JQuery.Promise<Morebits.wiki.api>;
}
