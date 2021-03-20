import { Config, configPreference, setDefaultConfig } from './Config';
import { addPortletLink } from './portlet';

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

	constructor() {
		let prefs = this.userPreferences();
		if (prefs) {
			Config.addSection(this.moduleName, { ...prefs, module: this.moduleName });
			setDefaultConfig(
				prefs.preferences.map((pref) => {
					return {
						name: pref.name,
						value: pref.default,
					};
				})
			);
		}
	}

	userPreferences(): { title: string; preferences: configPreference[] } | void {}

	addPreference(pref) {
		Config.addPreference(this.moduleName, pref);
	}

	addMenu() {
		addPortletLink(() => this.makeWindow(), this.portletName, this.portletId, this.portletTooltip);
	}

	/**
	 * Set of links shown in the bottom right of the module dialog.
	 * Object keys are labels and values are the wiki page names
	 */
	footerlinks: { [label: string]: string };

	makeWindow() {}
}
