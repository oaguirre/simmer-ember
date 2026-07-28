declare module 'swagger-jsdoc' {
	type SwaggerDefinition = Record<string, any>

	interface Options {
		swaggerDefinition?: SwaggerDefinition
		definition?: SwaggerDefinition
		apis?: string[]
		[key: string]: any
	}

	function swaggerJSDoc(options?: Options): Record<string, any>

	export default swaggerJSDoc
}
