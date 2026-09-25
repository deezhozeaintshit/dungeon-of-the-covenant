import { Client } from "@gradio/client";
import { InferenceClient } from "@huggingface/inference";
import { log } from "./logger.js";
import { validateSpaceFormat, detectSpaceType } from "./spaceTypes.js";

export async function initializeClients(config) {
  const { hfToken, modelSpace: initialModelSpace, workDir, modelSpaceType } = config;
  let modelSpace = initialModelSpace || "Tencent/Hunyuan3D-2";

  if (!hfToken || hfToken.startsWith("hf_placeholder")) {
    await log('WARN', "HF_TOKEN not configured yet; starting game-asset-mcp in ready/lazy mode.", workDir);
    return {
      inferenceClient: null,
      modelClient: null,
      modelSpace,
      spaceType: modelSpaceType || 'hunyuan3d'
    };
  }

  // Initialize Hugging Face Inference Client
  try {
    await log('INFO', "Initializing Hugging Face Inference Client...", workDir);
    await log('DEBUG', `HF_TOKEN length: ${hfToken ? hfToken.length : 0}`, workDir);
    await log('DEBUG', `HF_TOKEN first 4 chars: ${hfToken ? hfToken.substring(0, 4) : 'none'}`, workDir);
    
    const inferenceClient = new InferenceClient(hfToken);
    await log('INFO', "Successfully initialized Hugging Face Inference Client", workDir);
    await log('DEBUG', "InferenceClient initialized successfully", workDir);
    
    // Connect to Model Space API using Gradio client
    try {
      // Validate model space format
      if (!validateSpaceFormat(modelSpace)) {
        await log('ERROR', `Invalid model space format: "${modelSpace}". Format must be "username/space-name"`, workDir);
        throw new Error(`Invalid model space format: "${modelSpace}". Format must be "username/space-name" (e.g., "your-username/InstantMesh" or "your-username/Hunyuan3D-2"). Please check your MODEL_SPACE environment variable in the .env file.`);
      }
      
      await log('INFO', `Connecting to model space: ${modelSpace}...`, workDir);
      await log('INFO', "Using HF token authentication", workDir);
      
      // Additional logging for debugging
      await log('DEBUG', `MODEL_SPACE environment variable: "${initialModelSpace}"`, workDir);
      await log('DEBUG', `MODEL_SPACE after default fallback: "${modelSpace}"`, workDir);
      await log('DEBUG', `Is MODEL_SPACE using default? ${!initialModelSpace}`, workDir);
      
      // Check if the space exists before trying to connect to it
      await log('DEBUG', "Checking if space exists...", workDir);
      let alternativeSpace = null;
      
      try {
        // Try to fetch the space URL to see if it exists
        const spaceUrl = `https://huggingface.co/spaces/${modelSpace}`;
        await log('DEBUG', `Checking space URL: ${spaceUrl}`, workDir);
        
        const response = await fetch(spaceUrl, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${hfToken}` }
        });
        
        const spaceExists = response.ok;
        await log('DEBUG', `Space exists check result: ${spaceExists} (status: ${response.status})`, workDir);
        
        if (!spaceExists) {
          // If the space doesn't exist, try alternative casings
          if (modelSpace.toLowerCase().includes("hunyuan3d-2mini") ||
              modelSpace.toLowerCase().includes("hunyuan3dmini")) {
            // Try different casings for Hunyuan3D-2mini-Turbo
            const alternatives = [
              `${modelSpace.split('/')[0]}/Hunyuan3D-2mini-Turbo`,
              `${modelSpace.split('/')[0]}/hunyuan3d-2mini-turbo`,
              `${modelSpace.split('/')[0]}/Hunyuan3D-2mini`,
              `${modelSpace.split('/')[0]}/hunyuan3d-2mini`
            ];
            
            for (const alt of alternatives) {
              const altUrl = `https://huggingface.co/spaces/${alt}`;
              await log('DEBUG', `Checking alternative space URL: ${altUrl}`, workDir);
              
              const altResponse = await fetch(altUrl, {
                method: 'HEAD',
                headers: { Authorization: `Bearer ${hfToken}` }
              });
              
              if (altResponse.ok) {
                alternativeSpace = alt;
                await log('INFO', `Found alternative space: ${alternativeSpace}`, workDir);
                break;
              }
            }
          } else if (modelSpace.toLowerCase().includes("hunyuan")) {
            // Try different casings for Hunyuan3D-2
            const alternatives = [
              `${modelSpace.split('/')[0]}/Hunyuan3D-2`,
              `${modelSpace.split('/')[0]}/hunyuan3d-2`,
              `${modelSpace.split('/')[0]}/HunyuanD-2`
            ];
            
            for (const alt of alternatives) {
              const altUrl = `https://huggingface.co/spaces/${alt}`;
              await log('DEBUG', `Checking alternative space URL: ${altUrl}`, workDir);
              
              const altResponse = await fetch(altUrl, {
                method: 'HEAD',
                headers: { Authorization: `Bearer ${hfToken}` }
              });
              
              if (altResponse.ok) {
                alternativeSpace = alt;
                await log('INFO', `Found alternative space: ${alternativeSpace}`, workDir);
                break;
              }
            }
          } else if (modelSpace.toLowerCase().includes("instantmesh")) {
            // Try different casings for InstantMesh
            const alternatives = [
              `${modelSpace.split('/')[0]}/InstantMesh`,
              `${modelSpace.split('/')[0]}/instantmesh`,
              `${modelSpace.split('/')[0]}/Instantmesh`
            ];
            
            for (const alt of alternatives) {
              const altUrl = `https://huggingface.co/spaces/${alt}`;
              await log('DEBUG', `Checking alternative space URL: ${altUrl}`, workDir);
              
              const altResponse = await fetch(altUrl, {
                method: 'HEAD',
                headers: { Authorization: `Bearer ${hfToken}` }
              });
              
              if (altResponse.ok) {
                alternativeSpace = alt;
                await log('INFO', `Found alternative space: ${alternativeSpace}`, workDir);
                break;
              }
            }
          }
        }
      } catch (error) {
        await log('WARN', `Error checking if space exists: ${error.message}`, workDir);
        // Continue anyway, as the space might still be accessible
      }
      
      // Use the alternative space if found
      if (alternativeSpace) {
        await log('INFO', `Using alternative space: ${alternativeSpace} instead of ${modelSpace}`, workDir);
        await log('DEBUG', `Changing MODEL_SPACE from "${modelSpace}" to "${alternativeSpace}"`, workDir);
        // Store the original value for debugging
        const originalModelSpace = modelSpace;
        modelSpace = alternativeSpace;
        await log('DEBUG', `MODEL_SPACE changed from "${originalModelSpace}" to "${modelSpace}"`, workDir);
      }
      
      // Add a timeout to the connection attempt
      await log('DEBUG', `Creating connection promise for ${modelSpace} with token length ${hfToken.length}`, workDir);
      const connectionPromise = Client.connect(modelSpace, { hf_token: hfToken });
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Connection to ${modelSpace} timed out after 60 seconds`));
        }, 60000); // 60 second timeout
      });
      
      try {
        // Race the connection promise against the timeout
        await log('DEBUG', "Starting connection attempt with 60 second timeout...", workDir);
        const modelClient = await Promise.race([connectionPromise, timeoutPromise]);
        await log('INFO', `Successfully connected to model space: ${modelSpace}`, workDir);
        
        // Add more diagnostic logs
        await log('DEBUG', "Connection successful, checking client object...", workDir);
        await log('DEBUG', `Client object type: ${typeof modelClient}`, workDir);
        await log('DEBUG', `Client object methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(modelClient)).join(', ')}`, workDir);
        
        // Detect which space was duplicated
        await log('DEBUG', `Starting space type detection for "${modelSpace}"...`, workDir);
        // Log the modelSpace value right before detection
        await log('DEBUG', `About to detect space type for: "${modelSpace}"`, workDir);
        await log('DEBUG', `modelSpace lowercase: "${modelSpace.toLowerCase()}"`, workDir);
        await log('DEBUG', `Contains "hunyuan3d-2mini-turbo": ${modelSpace.toLowerCase().includes("hunyuan3d-2mini-turbo")}`, workDir);
        await log('DEBUG', `Contains "hunyuan": ${modelSpace.toLowerCase().includes("hunyuan")}`, workDir);
        await log('DEBUG', `Contains "instantmesh": ${modelSpace.toLowerCase().includes("instantmesh")}`, workDir);
        const spaceType = modelSpaceType || await detectSpaceType(modelClient, modelSpace, workDir);
        // We successfully connected to the space, so it's valid
        // Even if we couldn't determine the exact type, we'll use the detected type or manual override
        await log('INFO', `Using space type: ${spaceType}${modelSpaceType ? ' (manually specified)' : ''}`, workDir);
        await log('DEBUG', `Final space type: ${spaceType}`, workDir);
        
        
        return {
          inferenceClient,
          modelClient,
          modelSpace, // Return the potentially updated modelSpace
          spaceType
        };
        
      } catch (error) {
        await log('WARN', `Deferred model space connection (${error.message}); starting MCP server in lazy-connect mode.`, workDir);
        return {
          inferenceClient,
          modelClient: null,
          modelSpace,
          spaceType: modelSpaceType || 'hunyuan3d'
        };
      }
    } catch (error) {
      await log('WARN', `Deferred model space connection (${error.message}); starting MCP server in lazy-connect mode.`, workDir);
      return {
        inferenceClient,
        modelClient: null,
        modelSpace,
        spaceType: modelSpaceType || 'hunyuan3d'
      };
    }
  } catch (error) {
    await log('WARN', `Deferred Hugging Face client init (${error.message}); starting MCP server.`, workDir);
    return {
      inferenceClient: null,
      modelClient: null,
      modelSpace,
      spaceType: modelSpaceType || 'hunyuan3d'
    };
  }
}