function shutdownWorld(reason, dependencies: Record<string, any>) {
  const {
    gatewayRuntime,
    sessionRegistry,
    disconnectCharacterSession,
    spaceRuntime,
    log,
  } = dependencies;
  const errors: string[] = [];
  let playerCount = 0;
  let sceneCount = 0;

  try {
    gatewayRuntime.shutdown();
  } catch (error) {
    errors.push(`browser sessions: ${error.message}`);
  }

  for (const session of sessionRegistry.getRegisteredSessions()) {
    const characterID = sessionRegistry.resolveSessionCharacterID(session);
    if (characterID > 0) {
      try {
        const result = disconnectCharacterSession(session, {
          broadcast: false,
          clearSession: true,
          lifecycleReason: "server_shutdown",
        });
        if (!result || result.success !== true || result.cleanupErrors?.length > 0) {
          errors.push(`character ${characterID}: ${result?.cleanupErrors?.join(", ") || result?.errorMsg || "disconnect failed"}`);
        } else {
          playerCount += 1;
        }
      } catch (error) {
        errors.push(`character ${characterID}: ${error.message}`);
      }
    }
    try {
      sessionRegistry.unregister(session);
    } catch (error) {
      errors.push(`character ${characterID}: session unregister: ${error.message}`);
    }
    try {
      session.socket?.destroy?.();
    } catch (error) {
      errors.push(`character ${characterID}: socket close: ${error.message}`);
    }
  }

  for (const systemID of [...spaceRuntime.scenes.keys()]) {
    try {
      const result = spaceRuntime.unloadSolarSystemScene(systemID, {
        reason: "server_shutdown",
        broadcast: false,
        refreshStargates: false,
        log: false,
      });
      if (result?.unloaded === true) {
        sceneCount += 1;
      } else if (result?.reason !== "scene-not-loaded") {
        errors.push(`system ${systemID}: ${result?.reason || "scene unload failed"}`);
      }
    } catch (error) {
      errors.push(`system ${systemID}: ${error.message}`);
    }
  }

  log.info(`[WorldShutdown] ${reason}: unloaded ${playerCount} player session(s) and ${sceneCount} scene(s)`);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return { playerCount, sceneCount };
}

module.exports = { shutdownWorld };
