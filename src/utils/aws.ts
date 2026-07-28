import AWS from 'aws-sdk'
import { config } from '../constants/config'

// Primary S3 client for standard operations (uses configured credentials)
export const s3 = new AWS.S3({
	accessKeyId: config.s3.accessKeyId,
	secretAccessKey: config.s3.secretAccessKey,
	region: config.s3.region,
	signatureVersion: 'v2',
})

// Target S3 client for presigned URLs to target bucket (uses target credentials if available)
// Falls back to primary S3 client if target credentials not configured
const createTargetS3Client = (): AWS.S3 => {
	const targetAccessKeyId = process.env.AWS_TARGET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID
	const targetSecretKey = process.env.AWS_TARGET_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY
	const targetRegion = process.env.AWS_TARGET_REGION || config.s3.region

	if (targetAccessKeyId && targetSecretKey) {
		return new AWS.S3({
			accessKeyId: targetAccessKeyId,
			secretAccessKey: targetSecretKey,
			region: targetRegion,
			signatureVersion: 'v2',
		})
	}

	// Fallback to primary client if target credentials not available
	return s3
}

export const s3Target = createTargetS3Client()

export const uploadToS3 = async (file: any, key: string): Promise<AWS.S3.ManagedUpload.SendData> => {
	return await uploadBufferToS3(file.buffer, file.mimetype, key)
}

export const uploadBufferToS3 = async (buffer: any, mimetype: any, key: string): Promise<AWS.S3.ManagedUpload.SendData> => {
	const params: AWS.S3.PutObjectRequest = {
		Bucket: config.s3.bucketName,
		Key: key,
		Body: buffer,
		ContentType: mimetype,
	}

	return await s3
		.upload(params, {
			partSize: 5 * 1024 * 1024, // 5MB parts
			queueSize: 4, // parallel parts
			leavePartsOnError: false,
		})
		.promise()
}

export const getS3FileUrl = (key: string): string => {
	return `https://${config.s3.bucketName}.s3.${config.s3.region}.amazonaws.com/${key}`
}

export const deleteFromS3 = async (key: string): Promise<AWS.S3.DeleteObjectOutput> => {
	const params: AWS.S3.DeleteObjectRequest = {
		Bucket: config.s3.bucketName,
		Key: key,
	}

	return await s3.deleteObject(params).promise()
}

export const listS3Files = async (prefix: string): Promise<AWS.S3.ListObjectsV2Output> => {
	const params: AWS.S3.ListObjectsV2Request = {
		Bucket: config.s3.bucketName,
		Prefix: prefix,
	}

	return await s3.listObjectsV2(params).promise()
}

export const getS3FileStream = (key: string): NodeJS.ReadableStream => {
	const params: AWS.S3.GetObjectRequest = {
		Bucket: config.s3.bucketName,
		Key: key,
	}

	return s3.getObject(params).createReadStream()
}

export const getS3FileBuffer = async (key: string): Promise<Buffer> => {
	const stream = getS3FileStream(key)
	if (!stream) {
		throw new Error(`No profile image found for key ${key}`)
	}
	// Convert S3 Body to Buffer if necessary
	const imageBuffer = await new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = []
		stream.on('data', (chunk: Buffer) => chunks.push(chunk))
		stream.on('end', () => {
			resolve(Buffer.concat(chunks))
		})
		stream.on('error', reject)
	})
	if (!imageBuffer || imageBuffer.length === 0) {
		throw new Error('Image buffer is empty or undefined for key: ' + key)
	}
	return imageBuffer
}

export const copyS3File = async (sourceKey: string, destinationKey: string): Promise<AWS.S3.CopyObjectOutput> => {
	const params: AWS.S3.CopyObjectRequest = {
		Bucket: config.s3.bucketName,
		CopySource: `${config.s3.bucketName}/${sourceKey}`,
		Key: destinationKey,
	}

	return await s3.copyObject(params).promise()
}

export const moveS3File = async (sourceKey: string, destinationKey: string): Promise<void> => {
	await copyS3File(sourceKey, destinationKey)
	await deleteFromS3(sourceKey)
}

export const generateS3GetPresignedUrl = (key: string, expiresIn: number = 604800): string => {
	const params: AWS.S3.GetObjectRequest & { Expires?: number } = {
		Bucket: config.s3.bucketName,
		Key: key,
		Expires: expiresIn,
	}

	return s3Target.getSignedUrl('getObject', params)
}

export const generateS3PresignedUrl = (key: string, expiresIn: number = 3600): string => {
	const params: AWS.S3.PutObjectRequest & { Expires?: number } = {
		Bucket: config.s3.bucketName,
		Key: key,
		// @ts-expect-error Expires is valid here
		Expires: expiresIn || 3600, // Default to 1 hour if expiresIn is not provided
	}

	return s3Target.getSignedUrl('putObject', params)
}

export const getS3BucketLocation = async (): Promise<string> => {
	const params: AWS.S3.GetBucketLocationRequest = {
		Bucket: config.s3.bucketName,
	}

	const location = await s3.getBucketLocation(params).promise()
	return location.LocationConstraint || 'us-east-1' // Default to us-east-1 if no location is set
}

export const checkS3IfFileExists = async (bucketName: string, key: string) => {
	try {
		const res = await s3.headObject({ Bucket: bucketName, Key: key }).promise()
		return res.LastModified // File exists
	} catch (error: any) {
		if (error?.name === 'NotFound' || error?.code === 'NotFound' || error?.code === 'NoSuchKey' || error?.statusCode === 404) {
			return false
		}
		if (error?.name === 'Forbidden' || error?.code === 'Forbidden' || error?.code === 'AccessDenied' || error?.statusCode === 403) {
			console.warn(`[S3] access denied while checking object existence for key "${key}" in bucket "${bucketName}"`)
			return false
		}
		throw error
	}
}
