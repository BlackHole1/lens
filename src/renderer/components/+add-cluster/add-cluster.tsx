import "./add-cluster.scss";
import os from "os";
import React from "react";
import { observer } from "mobx-react";
import { action, computed, observable, runInAction } from "mobx";
import { remote } from "electron";
import { KubeConfig } from "@kubernetes/client-node";
import { DropFileInput, Input } from "../input";
import { AceEditor } from "../ace-editor";
import { Button } from "../button";
import { Icon } from "../icon";
import { kubeConfigDefaultPath, loadConfigFromFile, loadConfigFromString, splitConfig } from "../../../common/kube-helpers";
import { ClusterStore } from "../../../common/cluster-store";
import { v4 as uuid } from "uuid";
import { navigate } from "../../navigation";
import { UserStore } from "../../../common/user-store";
import { Notifications } from "../notifications";
import { Tab, Tabs } from "../tabs";
import { appEventBus } from "../../../common/event-bus";
import { PageLayout } from "../layout/page-layout";
import { docsUrl } from "../../../common/vars";
import { catalogURL } from "../+catalog";
import { List, ListItem, ListItemSecondaryAction, ListItemText, Switch, IconButton } from "@material-ui/core";
import { KeyboardArrowDown, KeyboardArrowUp } from "@material-ui/icons";

enum KubeConfigSourceTab {
  FILE = "file",
  TEXT = "text"
}

interface Option {
  config: KubeConfig;
  selected: boolean;
  error?: string;
}

function getContexts(config: KubeConfig): Map<string, Option> {
  return new Map(
    splitConfig(config)
      .map(({ config, error }) => [config.currentContext, {
        config,
        error,
        selected: false,
      }])
  );
}

@observer
export class AddCluster extends React.Component {
  @observable.ref fileBasedConfig: KubeConfig;
  @observable.ref error: React.ReactNode;

  // available contexts from kubeconfig-file or user-input
  @observable kubeContexts = observable.map<string, Option>();
  @observable sourceTab = KubeConfigSourceTab.FILE;
  @observable kubeConfigPath = "";
  @observable kubeConfigError = "";
  @observable customConfig = "";
  @observable proxyServer = "";
  @observable isWaiting = false;
  @observable showProxySettings = false;

  componentDidMount() {
    ClusterStore.getInstance().setActive(null);
    this.setKubeConfig(UserStore.getInstance().kubeConfigPath);
    appEventBus.emit({ name: "cluster-add", action: "start" });
  }

  componentWillUnmount() {
    UserStore.getInstance().markNewContextsAsSeen();
  }

  @computed get selectedContexts(): KubeConfig[] {
    return Array.from(this.kubeContexts.values())
      .filter(({ selected }) => selected)
      .map(({ config }) => config);
  }

  @computed get anySelected(): boolean {
    return this.selectedContexts.length > 0;
  }

  @action
  async setKubeConfig(filePath: string) {
    try {
      this.fileBasedConfig = await loadConfigFromFile(filePath);

      this.refreshContexts();
      this.kubeConfigPath = filePath;
      UserStore.getInstance().kubeConfigPath = filePath; // save to store
    } catch (error) {
      this.kubeConfigError = String(error);
    }
  }

  @action
  refreshContexts() {
    this.error = "";

    switch (this.sourceTab) {
      case KubeConfigSourceTab.FILE:
        this.kubeContexts.replace(getContexts(this.fileBasedConfig));
        break;
      case KubeConfigSourceTab.TEXT:
        try {
          this.kubeContexts.replace(getContexts(loadConfigFromString(this.customConfig || "{}")));
        } catch (err) {
          this.error = String(err);
        }
        break;
    }

    if (this.kubeContexts.size === 1) {
      for (const option of this.kubeContexts.values()) {
        option.selected = true;
      }
    }
  }

  selectKubeConfigDialog = async () => {
    const { dialog, BrowserWindow } = remote;
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      defaultPath: this.kubeConfigPath,
      properties: ["openFile", "showHiddenFiles"],
      message: `Select custom kubeconfig file`,
      buttonLabel: `Use configuration`,
    });

    if (!canceled && filePaths.length) {
      this.setKubeConfig(filePaths[0]);
    }
  };

  onDropKubeConfig = (files: File[]) => {
    this.sourceTab = KubeConfigSourceTab.FILE;
    this.setKubeConfig(files[0].path);
  };

  @action
  addClusters = () => {
    if (!this.selectedContexts.length) {
      return this.error = "Please select at least one cluster context";
    }

    try {
      this.error = "";
      this.isWaiting = true;
      appEventBus.emit({ name: "cluster-add", action: "click" });
      const newClusters = this.selectedContexts
        .map(config => {
          const clusterId = uuid();
          const kubeConfigPath = this.sourceTab === KubeConfigSourceTab.FILE
            ? this.kubeConfigPath // save link to original kubeconfig in file-system
            : ClusterStore.embedCustomKubeConfig(clusterId, config); // save in app-files folder

          return {
            id: clusterId,
            kubeConfigPath,
            contextName: config.currentContext,
            preferences: {
              httpsProxy: this.proxyServer || undefined,
            },
          };
        });

      runInAction(() => {
        ClusterStore.getInstance().addClusters(...newClusters);

        Notifications.ok(
          <>Successfully imported <b>{newClusters.length}</b> cluster(s)</>
        );

        navigate(catalogURL());
      });
      this.refreshContexts();
    } catch (err) {
      this.error = String(err);
      Notifications.error(<>Error while adding cluster(s): {this.error}</>);
    } finally {
      this.isWaiting = false;
    }
  };

  renderInfo() {
    return (
      <p>
        Add clusters by clicking the <span className="text-primary">Add Cluster</span> button.
        You&apos;ll need to obtain a working kubeconfig for the cluster you want to add.
        You can either browse it from the file system or paste it as a text from the clipboard.
        Read more about adding clusters <a href={`${docsUrl}/latest/clusters/adding-clusters/`} rel="noreferrer" target="_blank">here</a>.
      </p>
    );
  }

  renderFileTab() {
    return (
      <div>
        <div className="kube-config-select flex gaps align-center">
          <Input
            theme="round-black"
            className="kube-config-path box grow"
            value={this.kubeConfigPath}
            onChange={v => this.kubeConfigPath = v}
            onBlur={this.onKubeConfigInputBlur}
          />
          {this.kubeConfigPath !== kubeConfigDefaultPath && (
            <Icon
              material="settings_backup_restore"
              onClick={() => this.setKubeConfig(kubeConfigDefaultPath)}
              tooltip="Reset"
            />
          )}
          <Icon
            material="folder"
            onClick={this.selectKubeConfigDialog}
            tooltip="Browse"
          />
        </div>
        <small className="hint">
          Pro-Tip: you can also drag-n-drop kubeconfig file to this area
        </small>
      </div>
    );
  }

  renderTextTab() {
    return (
      <div className="flex column">
        <AceEditor
          autoFocus
          showGutter={false}
          mode="yaml"
          value={this.customConfig}
          onChange={value => {
            this.customConfig = value;
            this.refreshContexts();
          }}
        />
        <small className="hint">
          Pro-Tip: paste kubeconfig to get available contexts
        </small>
      </div>
    );
  }

  renderTab() {
    switch (this.sourceTab) {
      case KubeConfigSourceTab.FILE:
        return this.renderFileTab();
      case KubeConfigSourceTab.TEXT:
        return this.renderTextTab();
    }
  }

  renderKubeConfigSource() {
    return (
      <>
        <Tabs onChange={this.onKubeConfigTabChange}>
          <Tab
            value={KubeConfigSourceTab.FILE}
            label="Select kubeconfig file"
            active={this.sourceTab == KubeConfigSourceTab.FILE}/>
          <Tab
            value={KubeConfigSourceTab.TEXT}
            label="Paste as text"
            active={this.sourceTab == KubeConfigSourceTab.TEXT}
          />
        </Tabs>
        {this.renderTab()}
      </>
    );
  }

  renderContextSelectionEntry = (option: Option) => {
    const context = option.config.currentContext;
    const id = `context-selection-${context}`;

    return (
      <ListItem key={context} id={`context-selection-list-item-${context}`} disabled={Boolean(option.error)} style={{ fontSize: "inherit" }}>
        <ListItemText
          id={id}
          primary={context}
          secondary={option.error}
          secondaryTypographyProps={{ color: "error", variant: "inherit" }}
          primaryTypographyProps={{ variant: "inherit" }}
        />
        <ListItemSecondaryAction>
          <Switch
            edge="end"
            disabled={Boolean(option.error)}
            onChange={(event, checked) => this.kubeContexts.get(context).selected = checked}
            inputProps={{ "aria-labelledby": id }}
            color="primary"
          />
        </ListItemSecondaryAction>
      </ListItem>
    );
  };

  renderContextSelectionList() {
    const allContexts = Array.from(this.kubeContexts.values());

    return (
      <List style={{ fontSize: "inherit" }}>
        {allContexts.map(this.renderContextSelectionEntry)}
      </List>
    );
  }

  toggleShowProxySettings = () => {
    this.showProxySettings = !this.showProxySettings;
  };

  onKubeConfigInputBlur = () => {
    const isChanged = this.kubeConfigPath !== UserStore.getInstance().kubeConfigPath;

    if (isChanged) {
      this.kubeConfigPath = this.kubeConfigPath.replace("~", os.homedir());

      this.setKubeConfig(this.kubeConfigPath);
    }
  };

  onKubeConfigTabChange = (tabId: KubeConfigSourceTab) => {
    this.sourceTab = tabId;
    this.error = "";
    this.refreshContexts();
  };

  renderProxySettings() {
    return (
      <>
        <h3>
          Proxy settings
          <IconButton
            onClick={this.toggleShowProxySettings}
            style={{ fontSize: "inherit" }}
            color="inherit"
          >
            {
              this.showProxySettings
                ? <KeyboardArrowUp style={{ fontSize: "inherit" }} />
                : <KeyboardArrowDown style={{ fontSize: "inherit" }} />
            }
          </IconButton>
        </h3>
        {this.showProxySettings && (
          <div className="proxy-settings">
            <p>HTTP Proxy server. Used for communicating with Kubernetes API.</p>
            <Input
              autoFocus
              value={this.proxyServer}
              onChange={value => this.proxyServer = value}
              theme="round-black"
            />
            <small className="hint">
              {"A HTTP proxy server URL (format: http://<address>:<port>)."}
            </small>
          </div>
        )}
      </>
    );
  }

  renderError() {
    if (this.error) {
      return <div className="error">{this.error}</div>;
    }
  }

  renderAddClustersButton() {
    return (
      <div className="actions-panel">
        <Button
          primary
          disabled={!this.anySelected}
          label={this.selectedContexts.length === 1 ? "Add cluster" : "Add clusters"}
          onClick={this.addClusters}
          waiting={this.isWaiting}
          tooltip={this.anySelected || "Select at least one cluster to add."}
          tooltipOverrideDisabled
        />
      </div>
    );
  }

  render() {
    return (
      <DropFileInput onDropFiles={this.onDropKubeConfig}>
        <PageLayout className="AddClusters" showOnTop={true}>
          <h2>Add Clusters from Kubeconfig</h2>
          {this.renderInfo()}
          {this.renderKubeConfigSource()}
          {this.renderError()}
          {this.renderAddClustersButton()}
          {this.renderContextSelectionList()}
          {this.renderProxySettings()}
        </PageLayout>
      </DropFileInput>
    );
  }
}
