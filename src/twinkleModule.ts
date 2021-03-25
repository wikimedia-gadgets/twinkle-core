import { Config, PreferenceGroup, setDefaultConfig } from './Config';
import { addPortletLink } from './portlet';
import { arr_includes } from './utils';
import { userDisabledModules } from './init';

export let initialisedModules: TwinkleModule[] = [];

/**
 * Base class for all Twinkle modules
 */
export class TwinkleModule {
	/**
	 * The name of the module, used to check if the user
	 * has the module disabled
	 */
	static moduleName: string;
	moduleName: string;

	portletName: string;
	portletId: string;
	portletTooltip: string;

	constructor() {}

	static register(module: typeof TwinkleModule) {
		let prefs = module.userPreferences();
		if (prefs) {
			Config.addGroup(module.moduleName, { ...prefs, module: module.moduleName });
			setDefaultConfig(
				prefs.preferences.map((pref) => {
					return {
						name: pref.name,
						value: pref.default,
					};
				})
			);
		}

		if (!arr_includes(userDisabledModules, module.moduleName)) {
			initialisedModules.push(new module());
		}
	}

	static userPreferences(): PreferenceGroup | void {}

	addPreference(pref) {
		Config.addPreference(this.moduleName, pref);
	}

	addMenu() {
		addPortletLink(
			() => this.makeWindow(),
			this.portletName,
			this.portletId || 'twinkle-' + this.moduleName.toLowerCase(),
			this.portletTooltip
		);
	}

	/**
	 * Set of links shown in the bottom right of the module dialog.
	 * Object keys are labels and values are the wiki page names
	 */
	footerlinks: { [label: string]: string };

	makeWindow() {}
}
