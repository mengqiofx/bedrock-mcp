import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as readline from 'readline';
import "dotenv/config";

// Function to get user input
async function input(prompt: string = 'Enter your query: '): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function main() {
    const model = {
        modelId: 'mistral.mistral-large-2402-v1:0',
        region: 'ap-southeast-2',
    };
    
    console.log('Starting MCP + Bedrock test...');
    
    // Create MCP client
    const mcp = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: { sampling: {} } }
    );

    // Create transport
    const transport = new StdioClientTransport({
        command: "node",
        args: ["build/server.js"],
        stderr: 'inherit'
    });

    try {
        // Connect to MCP server first
        console.log('Connecting to MCP server...');
        await mcp.connect(transport);
        console.log('MCP server connected successfully!');

        // Get tools and resources from MCP server
        console.log('Fetching tools from MCP server...');
        const { tools } = await mcp.listTools();
        console.log(`Found ${tools.length} tools:`, tools.map(t => t.name));
        
        console.log('Fetching resources from MCP server...');
        const { resources } = await mcp.listResources();
        console.log(`Found ${resources.length} resources:`, resources.map(r => r.name));
        
        console.log('Fetching resource templates from MCP server...');
        const { resourceTemplates } = await mcp.listResourceTemplates();
        console.log(`Found ${resourceTemplates.length} resource templates:`, resourceTemplates.map(rt => rt.name));
        
        // Show resource details for debugging
        if (resources.length > 0) {
            console.log('Resource details:');
            resources.forEach(resource => {
                console.log(`  - ${resource.name}: ${resource.uri} (${resource.mimeType || 'unknown type'})`);
            });
        }
        
        // Show resource template details for debugging
        if (resourceTemplates.length > 0) {
            console.log('Resource template details:');
            resourceTemplates.forEach(template => {
                console.log(`  - ${template.name}: ${template.uriTemplate} (${template.mimeType || 'unknown type'})`);
            });
        }

        // Convert MCP tools to Bedrock tool format (Mistral format)
        const bedrockTools = tools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        }));

        // Add a custom resource access tool
        if (resources.length > 0 || resourceTemplates.length > 0) {
            const resourceList = resources.map(r => `${r.name} (${r.uri})`).join(", ");
            const templateList = resourceTemplates.map(rt => `${rt.name} template (${rt.uriTemplate}) - ${rt.description || 'No description'}`).join(", ");
            const allResources = [resourceList, templateList].filter(Boolean).join(", ");
            
            bedrockTools.push({
                type: "function",
                function: {
                    name: "get_resource",
                    description: `Get content from an MCP resource or use a resource template. Available resources: ${allResources}. For templates, replace {festival} with the actual festival name (e.g., calendar://festival/King's Birthday/date).`,
                    parameters: {
                        type: "object",
                        properties: {
                            resource_uri: {
                                type: "string",
                                description: "The full URI of the resource to fetch. For festival dates, use calendar://festival/{festival_name}/date format (e.g., calendar://festival/King's Birthday/date)"
                            }
                        },
                        required: ["resource_uri"]
                    }
                }
            });
        }

        // Create Bedrock client with SSO credential support
        let credentials;
        try {
            // Try to use SSO credentials first (if configured)
            const profileName = process.env.AWS_PROFILE || 'tr-dev';
            console.log(`Using AWS profile: ${profileName}`);
            credentials = fromIni({
                profile: profileName
            });
            console.log('Using AWS profile credentials (SSO or traditional)');
        } catch (error) {
            console.log('Profile credentials not available, falling back to environment variables');
            console.log('Error details:', error);
            // Falls back to environment variables or other credential providers
            credentials = undefined;
        }
        
        const client = new BedrockRuntimeClient({ 
            region: model.region,
            credentials: credentials
        });
        
        // Get user input for the query
        const qry = await input();

        // Prepare the payload for Bedrock with MCP tools (Mistral Large format)
        const payload = {
            max_tokens: 1024,
            temperature: 0.7,
            tools: bedrockTools,
            tool_choice: "auto",
            messages: [
                {
                    role: 'user',
                    content: qry,
                },
            ],
        };

        console.log('Sending request to Bedrock with MCP tools...');
        console.log('Available tools for Bedrock:', bedrockTools.map(t => t.function.name));

        // Invoke Claude with the payload and wait for the response.
        const command = new InvokeModelCommand({
            contentType: 'application/json',
            body: JSON.stringify(payload),
            modelId: model.modelId,
        });
        
        const apiResponse = await client.send(command);

        // Decode and return the response(s)
        const decodedResponseBody = new TextDecoder().decode(apiResponse.body);
        const responseBody = JSON.parse(decodedResponseBody);
        
        console.log('Bedrock response:', JSON.stringify(responseBody, null, 2));

        // If Bedrock wants to use a tool, execute it via MCP (Mistral format)
        if (responseBody.choices && responseBody.choices[0].message.tool_calls) {
            console.log('\nBedrock requested tool use, executing via MCP...');
            
            try {
                for (const toolCall of responseBody.choices[0].message.tool_calls) {
                    console.log('Processing tool call:', JSON.stringify(toolCall, null, 2));
                    if (toolCall.function) {
                        console.log(`Executing tool: ${toolCall.function.name} with args:`, toolCall.function.arguments);
                        
                        let args;
                        if (typeof toolCall.function.arguments === 'string') {
                            try {
                                args = JSON.parse(toolCall.function.arguments);
                            } catch (parseError) {
                                console.log('JSON parse error, trying to fix escaped quotes...');
                                const fixedJson = toolCall.function.arguments.replace(/\\'/g, "'");
                                args = JSON.parse(fixedJson);
                            }
                        } else {
                            args = toolCall.function.arguments;
                        }
                        
                        if (toolCall.function.name === 'get_resource') {
                            console.log(`Executing resource tool: ${toolCall.function.name}`);
                            console.log(`Arguments received:`, args);
                            
                            // If it's asking for a specific festival, construct the proper URI
                            if (args.resource_uri && args.resource_uri.includes('festival')) {
                                // Use the resource template format: calendar://festival/{festival}/date
                                const uri = args.resource_uri;
                                console.log(`Using festival resource URI: ${uri}`);
                                
                                const resourceResult = await mcp.readResource({ uri });
                                console.log('Resource fetch completed');
                                console.log(`Resource result:`, JSON.stringify(resourceResult, null, 2));
                                
                                // Extract and display the clean result
                                if (resourceResult.contents && resourceResult.contents.length > 0) {
                                    const content = JSON.parse(resourceResult.contents[0].text as string);
                                    console.log(`🎯 Final Answer: ${content.name} is on ${content.date}`);
                                }
                            } else {
                                // Handle other resources normally
                                const uri = args.resource_uri === 'calendar-list' ? 'calendar://all-festivals' : args.resource_uri;
                                console.log(`Using URI: ${uri}`);
                                
                                const resourceResult = await mcp.readResource({ uri });
                                console.log('Resource fetch completed');
                                console.log(`Resource result:`, JSON.stringify(resourceResult, null, 2));
                            }
                        } else {
                            // Handle regular MCP tools
                            console.log('About to call mcp.callTool...');
                            const toolResult = await mcp.callTool({
                                name: toolCall.function.name,
                                arguments: args
                            });
                            console.log('Tool call completed');
                            console.log(`Tool result:`, JSON.stringify(toolResult, null, 2));

                            // Extract and display the clean result
                            if (toolResult.content && Array.isArray(toolResult.content)) {
                                const cleanResults = toolResult.content
                                    .filter((item: any) => item.type === 'text')
                                    .map((item: any) => item.text)
                                    .join(', ');
                                console.log(`🎯 Tool Output: ${cleanResults}`);
                            }
                        }
                    }
                }
                console.log('All tool executions completed');
            } catch (toolError) {
                console.error(`Tool execution failed:`, toolError);
                console.error('Full error:', toolError);
            }
        }
        return responseBody;
        
    } catch (error) {
        console.error('Error during MCP + Bedrock test:', error);
        throw error;
    } finally {
        // Clean up MCP connection
        await mcp.close();
        console.log('MCP client connection closed.');
    }
}
main()