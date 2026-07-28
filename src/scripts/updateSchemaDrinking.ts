/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: `.${process.env.NODE_ENV || 'development'}.env` })

console.log('Environment:', process.env.NODE_ENV)
console.log('MongoDB Host:', process.env.MONGODB_HOST)
console.log('MongoDB Port:', process.env.MONGODB_PORT)

import connect from '../utils/db'
import { User } from '../resources/user/model'

const updateSchemaDrinking = async (): Promise<void> => {
	try {
		const users = await User.find({ drinking: { $type: 'bool' } }).lean()
		console.log(`Found ${users.length} users with boolean drinking field`)
		for (const user of users) {
			console.log(`Processing user ${String(user._id)}...`)
			const { drinking } = user as any
			switch (drinking) {
				case true:
					user.drinking = 'socially'
					break
				case false:
					user.drinking = 'never'
					break
				default:
					user.drinking = 'unanswered'
			}
			await User.findOneAndUpdate({ _id: user._id }, { drinking: user.drinking }, { new: true, runValidators: true })
			console.log(`Updated drinking for user ${String(user._id)}`)
		}
		console.log('Avatar drinking update process completed.')
	} catch (error) {
		console.error('Error updating drinking:', error)
	}
}

connect.call(
	updateSchemaDrinking()
		.then(async () => {
			console.log('Update process finished successfully.')
			process.exit(0)
		})
		.catch(error => {
			console.error('Update process encountered an error:', error)
			process.exit(1)
		}),
)

export default connect
