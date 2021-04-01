import { NS_MAIN, NS_PROJECT } from './namespaces';

/**
 * Site configuration for Twinkle.
 * These are usually MediaWiki configurations that are wiki-specific, but that
 * either can't be retrieved by Twinkle automatically, or are too expensive to
 * fetch.
 */
export namespace SiteConfig {
	/**
	 * Regex expression to check if a username is likely to be a bot.
	 */
	export let botUsernameRegex = /bot\b/i;

	/**
	 * Namespaces where FlaggedRevs (pending changes protection) is enabled.
	 * Needs to put in unless phab:T218479 happens.
	 * Copy the $wgFlaggedRevsNamespaces value for your wiki which you can find on
	 * https://noc.wikimedia.org/conf/highlight.php?file=flaggedrevs.php
	 * Used in protect module.
	 */
	export let flaggedRevsNamespaces = [NS_MAIN, NS_PROJECT];

	/**
	 * Local alias for Special:PermanentLink.
	 * Check using /w/api.php?action=query&meta=siteinfo&formatversion=2&siprop=specialpagealiases
	 * Include the namespace prefix.
	 * If there are multiple aliases, enter any one - preferably the one that's shorter
	 */
	export let permalinkSpecialPageName = 'Special:PermanentLink';

	/**
	 * Aliases for #REDIRECT tag.
	 * These are always case-insensitive.
	 * Please copy as-is from API output (name: "redirect")
	 * /w/api.php?action=query&format=json&meta=siteinfo&formatversion=2&siprop=magicwords
	 */
	export let redirectTagAliases = ['#REDIRECT'];
}
