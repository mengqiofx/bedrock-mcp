# MCP Server and Client with AWS Bedrock Integration

This project demonstrates how to integrate Model Context Protocol (MCP) servers with AWS Bedrock's Mistral Large model. The `awsClient.ts` file connects to an MCP server to access tools and resources, then uses AWS Bedrock to process user queries with those capabilities.

## Prerequisites

Before running the AWS client, make sure you have:

1. **Node.js** (version 16 or higher)
2. **AWS CLI** installed and configured
3. **AWS SSO** configured (if using SSO authentication)
4. **TypeScript** installed globally or via the project dependencies

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. AWS Configuration

#### Option A: AWS SSO (Recommended)
Configure AWS SSO with your organization:

```bash
aws configure sso
```

Set your AWS profile in the environment or let the application use the default `tr-dev` profile.


### 3. Environment Setup

Create a `.env` file in the root directory (optional):

```env
AWS_PROFILE=your-profile-name
AWS_REGION=ap-southeast-2
```

## Building the Project

Before running the AWS client, you need to build the TypeScript files:

```bash
npm run server:build
```

This compiles the TypeScript files to the `build/` directory.

## Running the AWS Client

### Method 1: Using npm script (Recommended)

The easiest way to run the AWS client:

```bash
npm run test:aws
```

This command will:
1. Authenticate with AWS SSO using the `tr-dev` profile
2. Start the AWS client
3. Prompt you for a query to process

### Method 2: Manual execution

If you prefer to run it manually:

```bash
# First, login to AWS SSO (if using SSO)
aws sso login --profile tr-dev

# Then run the client
npx tsx src/awsClient.ts
```

### Method 3: Using built files

After building the project:

```bash
# Login to AWS SSO (if using SSO)
aws sso login --profile tr-dev

# Run the built JavaScript file
node build/awsClient.js
```

## How It Works

1. **MCP Server Connection**: The client connects to a local MCP server running on `build/server.js`
2. **Resource Discovery**: It discovers available tools and resources from the MCP server
3. **User Input**: Prompts you to enter a query
4. **Bedrock Integration**: Sends your query to AWS Bedrock's Mistral Large model along with available MCP tools
5. **Tool Execution**: If Bedrock decides to use tools, executes them via the MCP server
6. **Results**: Displays the final response

## Example Usage

When you run the client, you'll see:

```
Starting MCP + Bedrock test...
Connecting to MCP server...
MCP server connected successfully!
Found X tools: [tool1, tool2, ...]
Found X resources: [resource1, resource2, ...]
Enter your query: What is the date of King's Birthday?
```

You can ask questions like:
- "What is the date of King's Birthday?"
- "List all available festivals"
- "When is Christmas this year?"

## Troubleshooting

### AWS Authentication Issues

1. **SSO Token Expired**: Run `aws sso login --profile tr-dev` again
2. **Profile Not Found**: Check your AWS config file (`~/.aws/config`) for the correct profile name
3. **Region Issues**: Ensure your AWS region supports Bedrock and the Mistral model

### MCP Server Issues

1. **Server Not Running**: Make sure you've built the project with `npm run server:build`
2. **Port Conflicts**: Check if another process is using the MCP server port

### TypeScript Compilation Issues

1. **Build Errors**: Run `npm run server:build` to see compilation errors
2. **Missing Dependencies**: Run `npm install` to ensure all packages are installed

## Development

### Running in Development Mode

For development with auto-reload:

```bash
# Terminal 1: Watch and build TypeScript files
npm run server:build:watch

# Terminal 2: Run the AWS client
npx tsx src/awsClient.ts
```

### Available Scripts

- `npm run server:build` - Build TypeScript files
- `npm run server:build:watch` - Build and watch for changes
- `npm run server:dev` - Run MCP server in development mode
- `npm run client:dev` - Run MCP client in development mode
- `npm run test:aws` - Run AWS client with SSO login

## Configuration

### AWS Region
The default region is `ap-southeast-2`. Change it in `src/awsClient.ts`:

```typescript
const model = {
    modelId: 'mistral.mistral-large-2402-v1:0',
    region: 'your-preferred-region', // Change this
};
```

### Model Selection
To use a different Bedrock model, modify the `modelId` in the same configuration object.

## License

This project is licensed under the ISC License.
