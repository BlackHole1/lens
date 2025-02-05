import type { MenuRegistration } from "./registries/menu-registry";
import { LensExtension } from "./lens-extension";
import { WindowManager } from "../main/window-manager";
import { getExtensionPageUrl } from "./registries/page-registry";
import { CatalogEntity, catalogEntityRegistry } from "../common/catalog";
import { IObservableArray } from "mobx";

export class LensMainExtension extends LensExtension {
  appMenus: MenuRegistration[] = [];

  async navigate<P extends object>(pageId?: string, params?: P, frameId?: number) {
    const windowManager = WindowManager.getInstance();
    const pageUrl = getExtensionPageUrl({
      extensionId: this.name,
      pageId,
      params: params ?? {}, // compile to url with params
    });

    await windowManager.navigate(pageUrl, frameId);
  }

  addCatalogSource(id: string, source: IObservableArray<CatalogEntity>) {
    catalogEntityRegistry.addSource(`${this.name}:${id}`, source);
  }

  removeCatalogSource(id: string) {
    catalogEntityRegistry.removeSource(`${this.name}:${id}`);
  }
}
