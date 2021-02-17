import { Twinkle } from './twinkle';
import { obj_entries } from './utils';

/**
 * Light wrapper around Morebits.simpleWindow
 * that sets the script name (Twinkle) and provides
 * a method to set footer links at once
 */
export class Dialog extends Morebits.simpleWindow {
	constructor(width: number, height: number) {
		super(width, height);
		this.setScriptName(Twinkle.scriptName);
	}
	setFooterLinks(links: Record<string, string>) {
		obj_entries(links).forEach((link) => {
			this.addFooterLink(link[0], link[1]);
		});
	}
}
