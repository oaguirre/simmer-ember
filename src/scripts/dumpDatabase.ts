/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: `.${process.env.NODE_ENV || 'development'}.env` })

console.log('Environment:', process.env.NODE_ENV)
console.log('MongoDB Host:', process.env.MONGODB_HOST)
console.log('MongoDB Port:', process.env.MONGODB_PORT)

import connect from '../utils/db'
import { User } from '../resources/user/model'
import { Moment } from '../resources/moment/model'
import Media from '../resources/media/model'
import fs from 'fs'

const dumpUserDataToJSON = async (): Promise<void> => {
	try {
		console.log('Dumping user data to JSON...')
		const users = await User.find({}).lean()
		const jsonFilePath = `./src/scripts/db/user_data_dump_${Date.now()}.json`
		fs.writeFileSync(jsonFilePath, JSON.stringify(users, null, 2))
		console.log(`User data dumped to JSON at ${jsonFilePath}`)
	} catch (error) {
		console.error('Error dumping user data to CSV:', error)
	}
}

const dumpMeetingDataToJSON = async (): Promise<void> => {
	try {
		console.log('Dumping meeting data to JSON...')
		const jsonFilePath = `./src/scripts/db/meeting_data_dump_${Date.now()}.json`
		const meetingData = await Moment.find({}).lean()
		fs.writeFileSync(jsonFilePath, JSON.stringify(meetingData, null, 2))
		console.log(`Meeting data dumped to JSON at ${jsonFilePath}`)
	} catch (error) {
		console.error('Error dumping meeting data to CSV:', error)
	}
}

const dumpMediaDataToJSON = async (): Promise<void> => {
	try {
		console.log('Dumping media data to JSON...')
		const jsonFilePath = `./src/scripts/db/media_data_dump_${Date.now()}.json`
		const mediaData = await Media.find({}).lean()
		fs.writeFileSync(jsonFilePath, JSON.stringify(mediaData, null, 2))
		console.log(`Media data dumped to JSON at ${jsonFilePath}`)
	} catch (error) {
		console.error('Error dumping media data to JSON:', error)
	}
}

const dumpDatabase = async (): Promise<void> => {
	try {
		await dumpUserDataToJSON()
		await dumpMeetingDataToJSON()
		await dumpMediaDataToJSON()
	} catch (error) {
		console.error('Error dumping database to JSON', error)
	}
}

connect.call(
	dumpDatabase()
		.then(async () => {
			console.log('Update process finished successfully.')
			await dumpDatabase()
			process.exit(0)
		})
		.catch(error => {
			console.error('Update process encountered an error:', error)
			process.exit(1)
		}),
)
export default connect
