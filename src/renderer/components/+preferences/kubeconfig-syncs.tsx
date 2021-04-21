

import React from "react";
import { remote } from "electron";
import { Avatar, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Paper } from "@material-ui/core";
import { Description, Folder, Delete, HelpOutline } from "@material-ui/icons";
import { action, computed, observable, reaction } from "mobx";
import { disposeOnUnmount, observer } from "mobx-react";
import fse from "fs-extra";
import { KubeconfigSyncEntry, UserStore } from "../../../common/user-store";
import { Button } from "../button";
import { SubTitle } from "../layout/sub-title";
import { Spinner } from "../spinner";
import logger from "../../../main/logger";
import { iter } from "../../utils";

interface SyncInfo {
  type: "file" | "folder" | "unknown";
}

interface Entry {
  filePath: string;
  info: SyncInfo;
}

async function getMapEntry(entry: KubeconfigSyncEntry): Promise<[string, SyncInfo]> {
  try {
    // stat follows the stat(2) linux syscall spec, namely it follows symlinks
    const stats = await fse.stat(entry.filePath);

    if (stats.isFile()) {
      return [entry.filePath, { type: "file" }];
    }

    if (stats.isDirectory()) {
      return [entry.filePath, { type: "folder" }];
    }

    logger.warn("[KubeconfigSyncs]: unknown stat entry", { stats });

    return [entry.filePath, { type: "unknown" }];
  } catch (error) {
    logger.warn(`[KubeconfigSyncs]: failed to stat entry: ${error}`, { error });

    return [entry.filePath, { type: "unknown" }];
  }
}

@observer
export class KubeconfigSyncs extends React.Component {
  syncs = observable.map<string, SyncInfo>();
  @observable loaded = false;

  async componentDidMount() {
    const mapEntries = await Promise.all(
      iter.map(
        UserStore.getInstance().syncKubeconfigEntries,
        filePath => getMapEntry({ filePath }),
      ),
    );

    this.syncs.replace(mapEntries);
    this.loaded = true;

    disposeOnUnmount(this, [
      reaction(() => Array.from(this.syncs.keys()), syncs => {
        UserStore.getInstance().syncKubeconfigEntries.replace(syncs);
      })
    ]);
  }

  @computed get syncsList(): Entry[] | undefined {
    if (!this.loaded) {
      return undefined;
    }

    return Array.from(this.syncs.entries(), ([filePath, info]) => ({ filePath, info }));
  }

  @action
  openFileDialog = async () => {
    const { dialog, BrowserWindow } = remote;
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      properties: ["openFile", "showHiddenFiles", "multiSelections", "openDirectory"],
      message: "Select kubeconfig file(s) and folder(s)",
      buttonLabel: "Sync",
    });

    if (canceled) {
      return;
    }

    const newEntries = await Promise.all(filePaths.map(filePath => getMapEntry({ filePath })));

    for (const [filePath, info] of newEntries) {
      this.syncs.set(filePath, info);
    }
  };

  renderEntryIcon(entry: Entry) {
    switch (entry.info.type) {
      case "file":
        return <Description />;
      case "folder":
        return <Folder />;
      case "unknown":
        return <HelpOutline />;
    }
  }

  renderEntry = (entry: Entry) => {
    return (
      <Paper className="entry" key={entry.filePath} elevation={3}>
        <ListItem>
          <ListItemAvatar>
            <Avatar>
              {this.renderEntryIcon(entry)}
            </Avatar>
          </ListItemAvatar>
          <ListItemText
            primary={entry.filePath}
            className="description"
          />
          <ListItemSecondaryAction className="action">
            <IconButton
              edge="end"
              aria-label="delete"
              onClick={() => this.syncs.delete(entry.filePath)}
            >
              <Delete />
            </IconButton>
          </ListItemSecondaryAction>
        </ListItem>
      </Paper>
    );
  };

  renderEntries() {
    const entries = this.syncsList;

    if (!entries) {
      return (
        <div className="loading-spinner">
          <Spinner />
        </div>
      );
    }

    return (
      <List className="kubeconfig-sync-list">
        {entries.map(this.renderEntry)}
      </List>
    );
  }

  render() {
    return (
      <>
        <section className="small">
          <SubTitle title="Files and Folders to sync" />
          <Button
            primary
            label="Sync file or folder"
            onClick={() => void this.openFileDialog()}
          />
          <div className="hint">
            Sync an individual file or folder shallowly.
          </div>
          {this.renderEntries()}
        </section>
      </>
    );
  }
}
