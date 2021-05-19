import type { TwinkleModule } from './twinkleModule';

/**
 * Defined as a namespace: anything that's exported from here (such as
 * addInitCallback) is accessible from outside (as Twinkle.addInitCallback)
 * Other items (like initCallbacks) can only be accessed from within here
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Twinkle {
	/**
	 * Localised script name
	 */
	export let scriptName = 'Twinkle';

	/**
	 * User agent
	 * @see https://meta.wikimedia.org/wiki/User-Agent_policy
	 */
	export let userAgent = 'Twinkle (' + mw.config.get('wgWikiID') + ')';

	/**
	 * Custom change tag(s) to be applied to all Twinkle actions, create at [[Special:Tags]]
	 * Use of changeTags is recommended over summaryAd as it enables better usage tracking,
	 * however summaryAd is set by default as it doesn't require creation of a tag
	 */
	export let changeTags = '';

	/**
	 * Text appended to all edit summaries and log summaries for Twinkle actions. This is automatically
	 * used by Twinkle.page if changeTags isn't specified above. This may also be used manually
	 * for any actions that don't support use of change tags.
	 *
	 * You'd want to override this, providing a link to the local project page
	 * about Twinkle.
	 */
	export let summaryAd = ` (${scriptName})`;

	/**
	 * List of functions that to be run before any modules are initialised. If
	 * a function returns a promise, it will be awaited. Ensure that the promise
	 * resolves. Twinkle modules will not be initialised if any of these functions
	 * throws an error or returns a rejected promise.
	 */
	export let preModuleInitHooks: Array<() => void | PromiseLike<void>> = [];

	/**
	 * Initialisation hooks that can access the user config via getPref().
	 * These are executed after the user config is loaded and before modules are
	 * initialised. If a hook returns a promise, it will be awaited.
	 */
	export let preModuleInitHooksWithConfig: Array<() => void | PromiseLike<void>> = [];

	/**
	 * List of registered modules
	 */
	export let registeredModules: typeof TwinkleModule[] = [];

	/**
	 * List of special pages where Twinkle is active.
	 */
	export let activeSpecialPages = ['Block', 'Contributions', 'Recentchanges', 'Recentchangeslinked'].concat(
		Morebits.userIsSysop ? ['DeletedContributions', 'Prefixindex'] : []
	);

	/**
	 * Override twinkle-core messages - such as for places where the wiki's processes need to be mentioned
	 * and thus are not suitable to be included as translations.
	 */
	export let messageOverrides: Record<string, string> = {};

	/**
	 * List of additional MediaWiki messages to be fetched.
	 */
	export let extraMwMessages: string[] = [];
}
