import Banana, { Messages } from 'orange-i18n';
import { obj_entries, urlParamValue } from './utils';
import { Twinkle } from './twinkle';

import coreMwMessages from './mw-messages';
import enMessages from '../i18n/en.json';

/**
 * Orange-i18n object
 */
let banana: Banana;

/**
 * The language used for all messages in twinkle-core.
 * This includes interface messages as well as edits made to the wiki.
 * Ideally the interface messages should have been in wgUserLanguage
 * and edits in wgContentLanguage, but this duality is not presently
 * supported.
 */
// I believe this is the only use of mw.* at the top level
export let language = urlParamValue('uselang') || mw.config.get('wgContentLanguage');

let qqxMode: boolean;

const i18nParserPlugins = {
	date(nodes) {
		// Check if it's already Date or Morebits.date object
		// otherwise assume we can construct a Morebits.date
		// out of it
		let mbDate =
			typeof nodes[0].getTime === 'function' ? new Morebits.date(nodes[0].getTime()) : new Morebits.date(nodes[0]);

		let format = nodes[1];
		// XXX: Don't assume the wiki's timezone is UTC
		let zone: 'utc' | undefined = nodes[2] === 'utc' ? 'utc' : undefined;
		if (format === 'relative') {
			return mbDate.calendar(zone);
		} else {
			return mbDate.format(format, zone);
		}
	},

	// Embedded messages
	int(nodes) {
		let msgName = nodes[0],
			msgParams = nodes.slice(1);
		return msg(msgName, ...msgParams);
	},

	// Adapted from mediawiki.jqueryMsg
	ns(nodes) {
		var ns = String(nodes[0]).trim();
		if (!/^\d+$/.test(ns)) {
			ns = String(mw.config.get('wgNamespaceIds')[ns.replace(/ /g, '_').toLowerCase()]);
		}
		ns = mw.config.get('wgFormattedNamespaces')[ns];
		return ns || '';
	},

	ucfirst(nodes) {
		return Morebits.string.toUpperCaseFirstChar(nodes[0]);
	},

	lcfirst(nodes) {
		return Morebits.string.toLowerCaseFirstChar(nodes[0]);
	},

	list(nodes) {
		let list = nodes[0];
		let text = '';
		for (let i = 0; i < list.length; i++) {
			text += list[i];
			if (list.length - 2 === i) {
				text += msg('and') + msg('word-separator');
			} else if (list.length - 1 !== i) {
				text += msg('comma-separator');
			}
		}
		return text;
	},

	// Experimental
	sysop(nodes) {
		return Morebits.userIsSysop ? nodes[1] : nodes[2];
	},
};

/**
 * Load messages into the message store.
 * @param messages
 */
export function addMessages(messages: Messages) {
	banana.load(messages, language);
}

/**
 * Get parsed message.
 * @param msg - the message name
 * @param parameters - the parameters for $1, $2, ... substitutions
 */
// type of msg must be "string", however switching it to "keyof typeof messages"
// is convenient during development for IDE tooling
export function msg(msg: string, ...parameters: (string | number | string[] | Date)[]) {
	if (!banana) {
		// this will come up when msg() is accidentally used at the top level of code
		// when the messages wouldn't have loaded
		throw new Error("Can't emit messages before initMessaging() has run!");
	}
	if (qqxMode) {
		return '(' + msg + ')';
	}
	return banana.i18n(msg, ...parameters);
}

// Populate default English messages, final fallback
// @ts-ignore this can be disabled through a build-stage variable injected by webpack's DefinePlugin
let EnglishMessagesAvailable = typeof EXCLUDE_ENGLISH_MESSAGES === 'undefined' || !EXCLUDE_ENGLISH_MESSAGES;

/**
 * Initialize the message store. Called from init.ts.
 */
export function initMessaging() {
	banana = new Banana(language);

	// Register plugins
	obj_entries(i18nParserPlugins).forEach(([name, plugin]) => {
		banana.registerParserPlugin(name, plugin);
	});

	// Set Morebits i18n
	Morebits.i18n.setParser({ get: msg });

	// QQX is a dummy "language" for documenting messages
	// No need to load anything when in qqxMode
	qqxMode = language === 'qqx';

	if (qqxMode) {
		return Promise.resolve();
	}

	if (EnglishMessagesAvailable) {
		banana.load(enMessages, 'en');
	}
	const mwMessageList = coreMwMessages.concat(Twinkle.extraMwMessages);
	return Promise.all([loadMediaWikiMessages(mwMessageList), loadTwinkleCoreMessages()])
		.catch((e) => {
			mw.notify('Failed to load messages needed for Twinkle', { type: 'error' });
		})
		.finally(() => {
			addMessages(Twinkle.messageOverrides);
		});
}

/**
 * Load the messages available in MediaWiki using the API.
 * These will include generic items such as month/day names, etc.
 * See mw-messages.ts for the list of keys.
 */
function loadMediaWikiMessages(msgList: string[]): Promise<void> {
	let promises = [];
	for (let i = 0; i < msgList.length; i += 50) {
		promises.push(
			// Mediawiki namespace-based overrides of MW messages do get taken
			// into account
			new mw.Api()
				.getMessages(msgList.slice(i, i + 50), {
					amlang: language,
					// cache them, as messages are not going to change that often
					maxage: 31536000, // 1 year
					smaxage: 31536000,
					// uselang enables public caching, see https://phabricator.wikimedia.org/T97096
					uselang: 'content',
				})
				.then((msgsFromApi) => {
					addMessages(msgsFromApi);
				})
		);
	}
	// @ts-ignore
	return Promise.all(promises);
}

/**
 * Load twinkle-core messages from Gerrit. Gerrit is quite slow. Also, it doesn't set any Cache-Control header.
 * So we use client-side storage instead to prevent repeated slow fetches.
 * Note: getting and setting data to/from localStorage (which mw.storage uses under the hood)
 * is synchronous.
 */
function loadTwinkleCoreMessages() {
	if (language === 'en' && EnglishMessagesAvailable) {
		// English messages are already available as the final fallback
		return Promise.resolve();
	}

	const storageKey = `tw-i18n-${language}`;
	const json = mw.storage.getObject(storageKey);
	// Don't use data stale by more than 2 days
	if (json && new Morebits.date(json['@timestamp']).add(2, 'days').isAfter(new Date())) {
		initBanana(json);
		return Promise.resolve();
	}
	$.get(
		'https://gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/TwinkleCore/+/i18n/build-i18n/' +
			language +
			'.json?format=text'
	).then(
		(base64text) => {
			// Adapted from https://phabricator.wikimedia.org/diffusion/WGPI/browse/master/proveit.js
			let json = JSON.parse(
				decodeURIComponent(
					window
						.atob(base64text)
						.split('')
						.map(function (character) {
							return '%' + ('00' + character.charCodeAt(0).toString(16)).slice(-2);
						})
						.join('')
				)
			);
			json['@timestamp'] = new Date().toISOString();
			mw.storage.setObject(storageKey, json);
			initBanana(json);
		},
		// If messages are requested for a language for which we don't have an i18n file,
		// Gerrit raises a CORS error due to some reason.
		(err) => {
			mw.log.warn('[twinkle]: no messages loaded from gerrit.', err);
		}
	);
}

function initBanana(json) {
	banana.setFallbackLocales(json['@fallbacks']);
	delete json['@fallbacks'];
	delete json['@timestamp'];
	banana.load(json);
}

/**
 * Load messages from MediaWiki, in addition to what twinkle-core loads.
 * Deprecated: Instead of using this, set extra messages in Twinkle.extraMwMessages
 * array, and init() would fetch those too.
 * @param messageList
 * @deprecated
 */
export function loadAdditionalMediaWikiMessages(messageList: string[]) {
	return loadMediaWikiMessages(messageList);
}
