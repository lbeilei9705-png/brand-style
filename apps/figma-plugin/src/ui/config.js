      async function loadConfig() {
        if (isLoadingConfig) {
          return;
        }

        isLoadingConfig = true;
        trackEvent("config_load_start");
        const selectedModelId = modelSelect.value;
        const selectedAgentId = agentSelect.value;
        const selectedMaterialIds = [...materialPresetIds];
        const selectedColorPaletteId = colorPaletteSelect.value;
        const selectedShapeArchitectureId = shapeArchitectureSelect.value;

        try {
          const [modelsResponse, agentsResponse, materialsResponse, colorPalettesResponse, shapeArchitecturesResponse, scenariosResponse, scenarioAgentsResponse] = await Promise.all([
            apiFetch("/api/config/models"),
            apiFetch("/api/config/style-skills"),
            apiFetch("/api/config/materials"),
            apiFetch("/api/config/color-palettes"),
            apiFetch("/api/config/shape-architectures"),
            apiFetch("/api/config/operation-scenarios"),
            apiFetch("/api/config/scenario-agents"),
          ]);
          const failedResponse = [
            modelsResponse,
            agentsResponse,
            materialsResponse,
            colorPalettesResponse,
            shapeArchitecturesResponse,
            scenariosResponse,
            scenarioAgentsResponse,
          ].find((response) => !response.ok);

          if (failedResponse) {
            const errorData = await failedResponse.json().catch(() => ({}));
            throw createApiError(failedResponse, errorData, "加载配置失败。");
          }

          const modelsData = await modelsResponse.json();
          const agentsData = await agentsResponse.json();
          const materialsData = await materialsResponse.json();
          const colorPalettesData = await colorPalettesResponse.json();
          const shapeArchitecturesData = await shapeArchitecturesResponse.json();
          const scenariosData = await scenariosResponse.json();
          const scenarioAgentsData = await scenarioAgentsResponse.json();

          modelSelect.innerHTML = "";
          agentSelect.innerHTML = "";
          colorPaletteSelect.innerHTML = "";
          shapeArchitectureSelect.innerHTML = "";

          for (const model of modelsData.models.filter((item) => item.enabled && (item.purpose || "image") === "image")) {
            const option = document.createElement("option");
            option.value = model.id;
            option.textContent = model.name;
            modelSelect.appendChild(option);
          }

          const emptyAgentOption = document.createElement("option");
          emptyAgentOption.value = "";
          emptyAgentOption.textContent = "未选择风格套装";
          agentSelect.appendChild(emptyAgentOption);

          for (const agent of (agentsData.styleSkills || agentsData.agents || []).filter((item) => item.enabled)) {
            const option = document.createElement("option");
            option.value = agent.id;
            option.textContent = agent.name;
            agentSelect.appendChild(option);
          }

          materials = (materialsData.materials || []).filter((item) => item.enabled);
          colorPalettes = (colorPalettesData.colorPalettes || []).filter((item) => item.enabled);
          operationScenarios = (scenariosData.operationScenarios || []).filter((item) => item.enabled);
          scenarioAgents = (scenarioAgentsData.scenarioAgents || defaultScenarioAgents).filter((item) => item.enabled !== false);

          const emptyPaletteOption = document.createElement("option");
          emptyPaletteOption.value = "";
          emptyPaletteOption.textContent = "未选择配色";
          colorPaletteSelect.appendChild(emptyPaletteOption);

          for (const palette of colorPalettes) {
            const option = document.createElement("option");
            option.value = palette.id;
            option.textContent = palette.name;
            colorPaletteSelect.appendChild(option);
          }

          const emptyShapeArchitectureOption = document.createElement("option");
          emptyShapeArchitectureOption.value = "";
          emptyShapeArchitectureOption.textContent = "未选择形状";
          shapeArchitectureSelect.appendChild(emptyShapeArchitectureOption);

          for (const architecture of (shapeArchitecturesData.shapeArchitectures || []).filter((item) => item.enabled)) {
            const option = document.createElement("option");
            option.value = architecture.id;
            option.textContent = architecture.name;
            shapeArchitectureSelect.appendChild(option);
          }

          const modelOptions = [...modelSelect.options];
          if (selectedModelId && modelOptions.some((option) => option.value === selectedModelId)) {
            modelSelect.value = selectedModelId;
          } else if (modelOptions.some((option) => option.value === defaultModelId)) {
            modelSelect.value = defaultModelId;
          }

          if (selectedAgentId && [...agentSelect.options].some((option) => option.value === selectedAgentId)) {
            agentSelect.value = selectedAgentId;
          }

          materialPresetIds = selectedMaterialIds.filter((id) => materials.some((material) => material.id === id));

          if (selectedColorPaletteId && [...colorPaletteSelect.options].some((option) => option.value === selectedColorPaletteId)) {
            colorPaletteSelect.value = selectedColorPaletteId;
          }

          if (selectedShapeArchitectureId && [...shapeArchitectureSelect.options].some((option) => option.value === selectedShapeArchitectureId)) {
            shapeArchitectureSelect.value = selectedShapeArchitectureId;
          }

          colorPaletteId = colorPaletteSelect.value;
          shapeArchitectureId = shapeArchitectureSelect.value;
          renderPaletteInlineEditor();
          renderMaterialPanel();
          updateRunState();
          trackEvent("config_load_success", {
            modelCount: modelSelect.options.length,
            styleCount: agentSelect.options.length,
            materialCount: materials.length,
          });
        } catch (error) {
          trackEvent("config_load_fail", { issueId: ensureIssueId(error), requestId: error?.requestId });
          throw error;
        } finally {
          isLoadingConfig = false;
        }
      }

