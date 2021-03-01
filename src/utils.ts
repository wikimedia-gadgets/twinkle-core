export function makeArray<T>(obj: T | Array<T> | undefined | null): Array<T> {
	if (!obj) {
		return [];
	}
	if (Array.isArray(obj)) {
		return obj;
	}
	return [obj];
}

/**
 * Remove namespace name from title if present
 * Exception-safe wrapper around mw.Title
 * @param {string} title
 */
export function stripNs(title: string): string {
	var title_obj = mw.Title.newFromUserInput(title);
	if (!title_obj) {
		return title; // user entered invalid input; do nothing
	}
	return title_obj.getNameText();
}

/**
 * Add namespace name to page title if not already given
 * CAUTION: namespace name won't be added if a namespace (*not* necessarily
 * the same as the one given) already is there in the title
 * @param {string} title
 * @param {number} namespaceNumber
 */
export function addNs(title: string, namespaceNumber: number): string {
	var title_obj = mw.Title.newFromUserInput(title, namespaceNumber);
	if (!title_obj) {
		return title; // user entered invalid input; do nothing
	}
	return title_obj.toText();
}

/**
 * Get URL parameter.
 * Alias for mw.util.getParamValue
 * @param param
 */
export function urlParamValue(param: string): string {
	return mw.util.getParamValue(param);
}

// Used in batch, unlink, and deprod to sort pages by namespace, as
// json formatversion=2 sorts by pageid instead (#1251)
export function sortByNamespace(first, second) {
	return first.ns - second.ns || (first.title > second.title ? 1 : -1);
}

// Used in batch listings to link to the page in question with >
export function generateArrowLinks(checkbox: HTMLInputElement) {
	var link = Morebits.htmlNode('a', ' >');
	link.setAttribute('class', 'tw-arrowpage-link');
	link.setAttribute('href', mw.util.getUrl(checkbox.value));
	link.setAttribute('target', '_blank');
	checkbox.nextElementSibling.append(link);
}

// Used in deprod and unlink listings to link the page title
export function generateBatchPageLinks(checkbox: HTMLInputElement) {
	var $checkbox = $(checkbox);
	var link = Morebits.htmlNode('a', $checkbox.val() as string);
	link.setAttribute('class', 'tw-batchpage-link');
	link.setAttribute('href', mw.util.getUrl($checkbox.val() as string));
	link.setAttribute('target', '_blank');
	$checkbox.next().prepend([link, ' ']);
}

/**
 * Make template wikitext from the template name and parameters
 * @param {string} name - name of the template. Include "subst:" if necessary
 * @param {Object} parameters - object with keys and values being the template param names and values.
 * Use numbers as keys for unnamed parameters.
 * If a value is falsy (undefined or null or empty string), the param doesn't appear in output.
 * @returns {string}
 */
export function makeTemplate(name: string, parameters: Record<string | number, string>): string {
	let parameterText = obj_entries(parameters)
		.filter(([k, v]) => !!v) // ignore params with no value
		.map(([name, value]) => `|${name}=${value}`)
		.join('');
	return '{{' + name + parameterText + '}}';
}

export function objectFromEntries(entries: [string, any][]) {
	let obj = {};
	for (let [key, val] of entries) {
		obj[key] = val;
	}
	return obj;
}

// Non-polluting shims for common ES6 functions

export function obj_values<T>(obj: { [s: string]: T } | ArrayLike<T>): T[] {
	// @ts-ignore
	return Object.values ? Object.values(obj) : Object.keys(obj).map((k) => obj[k]);
}

export function obj_entries<T>(obj: { [s: string]: T } | ArrayLike<T>): [string, T][] {
	// @ts-ignore
	return Object.entries ? Object.entries(obj) : Object.keys(obj).map((k) => [k, obj[k]]);
}

export function arr_includes<T>(arr: Array<T>, item: T): boolean {
	return arr.indexOf(item) !== -1;
}

export function arr_find<T>(arr: Array<T>, predicate: (item: T) => boolean) {
	// @ts-ignore
	return Array.prototype.find ? arr.find(predicate) : arr.filter(predicate)[0];
}

export function str_includes(str: string, item: string): boolean {
	return str.indexOf(item) !== -1;
}

export function str_startsWith(str: string, text: string): boolean {
	// @ts-ignore
	return String.prototype.startsWith ? str.startsWith(text) : str.indexOf(text) === 0;
}

export function str_endsWith(str: string, text: string): boolean {
	// @ts-ignore
	if (String.prototype.endsWith) {
		// @ts-ignore
		return str.endsWith(text);
	} else {
		let lastIdx = str.lastIndexOf(text);
		return lastIdx !== -1 && lastIdx === str.length - text.length;
	}
}
