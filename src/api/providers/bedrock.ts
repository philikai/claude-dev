import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"

export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: AnthropicBedrock

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new AnthropicBedrock({
			// Authenticate by either providing the keys below or use the default AWS credential providers, such as
			// using ~/.aws/credentials or the "AWS_SECRET_ACCESS_KEY" and "AWS_ACCESS_KEY_ID" environment variables.
			...(this.options.awsAccessKey ? { awsAccessKey: this.options.awsAccessKey } : {}),
			...(this.options.awsSecretKey ? { awsSecretKey: this.options.awsSecretKey } : {}),
			...(this.options.awsSessionToken ? { awsSessionToken: this.options.awsSessionToken } : {}),

			// awsRegion changes the aws region to which the request is made. By default, we read AWS_REGION,
			// and if that's not present, we default to us-east-1. Note that we do not read ~/.aws/config for the region.
			awsRegion: this.options.awsRegion,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const stream = await this.client.messages.create({
			model: this.getModelId(),
			max_tokens: this.getModel().info.maxTokens || 8192,
			temperature: 0,
			system: systemPrompt,
			messages,
			stream: true,
		})
		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start":
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
					}
					break
				case "message_delta":
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break

				case "content_block_start":
					switch (chunk.content_block.type) {
						case "text":
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
					}
					break
			}
		}
	}

	getModel(): { id: BedrockModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			const id = modelId as BedrockModelId
			return { id, info: bedrockModels[id] }
		}
		return { id: bedrockDefaultModelId, info: bedrockModels[bedrockDefaultModelId] }
	}

	private getModelId(): string {
		const { id } = this.getModel()
		const region = this.options.awsRegion || ""
		const useCrossRegion = this.options.awsUseCrossRegionInference

		if (useCrossRegion) {
			if (region.startsWith("us-")) {
				console.log(`[AWS Bedrock] Using cross-region inference with US model: us.${id}`)
				return `us.${id}`
			} else if (region.startsWith("eu-")) {
				console.log(`[AWS Bedrock] Using cross-region inference with EU model: eu.${id}`)
				return `eu.${id}`
			} else {
				console.warn(
					`[AWS Bedrock] Cross-region inference not supported for region: ${region}. Falling back to standard model.`
				)
			}
		}

		console.log(`[AWS Bedrock] Using standard model: ${id}`)
		return id
	}
}
