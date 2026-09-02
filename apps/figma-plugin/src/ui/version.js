      function compareVersions(left, right) {
        const leftParts = String(left || "0").split(".").map((part) => Number(part) || 0);
        const rightParts = String(right || "0").split(".").map((part) => Number(part) || 0);
        const length = Math.max(leftParts.length, rightParts.length);
        for (let index = 0; index < length; index += 1) {
          const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
          if (difference) return difference;
        }
        return 0;
      }

      async function initializeVersionCompatibility() {
        try {
          versionLabel.textContent = `v${pluginBuild.version}`;
          versionLabel.title = `插件 ${pluginBuild.version} · ${pluginBuild.commit}`;
          const response = await apiFetch("/api/health", { skipAuth: true });
          if (!response.ok) return;
          const health = await response.json();
          serverBuild = health.build || null;
          const minimumVersion = serverBuild?.minimumClientVersion;
          const outdated = minimumVersion && compareVersions(pluginBuild.version, minimumVersion) < 0;
          if (outdated) {
            versionWarning = `当前插件版本过旧，请更新到 v${minimumVersion} 或更高版本。`;
            versionLabel.textContent = `v${pluginBuild.version} · 请更新`;
            versionLabel.classList.add("version-warning");
            addMessage("system", versionWarning);
            if (!memberLoginOverlay.hidden) memberLoginStatus.textContent = versionWarning;
          }
        } catch (error) {
          recordClientError(error, { operation: "version_check" });
        }
      }

      function trackPluginStarted() {
        trackEvent("plugin_started", {
          clientVersion: pluginBuild.version,
          clientCommit: pluginBuild.commit,
          serverVersion: serverBuild?.version,
          minimumClientVersion: serverBuild?.minimumClientVersion,
          outdated: Boolean(serverBuild?.minimumClientVersion
            && compareVersions(pluginBuild.version, serverBuild.minimumClientVersion) < 0),
        });
      }
