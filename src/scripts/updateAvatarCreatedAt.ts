/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: `.${process.env.NODE_ENV || 'development'}.env` })

console.log('Environment:', process.env.NODE_ENV)
console.log('MongoDB Host:', process.env.MONGODB_HOST)
console.log('MongoDB Port:', process.env.MONGODB_PORT)

import connect from '../utils/db'
import { config } from '../constants/config'
import { User } from '../resources/user/model'
import { getAvatarFilename } from '../utils/user/helper'
import { checkS3IfFileExists } from '../utils/aws'

const isThereAvatarS3File = async (userId: string): Promise<boolean | Date | undefined> => {
  const avatarFilename = getAvatarFilename(userId)
  const bucket = config.s3.bucketName
  console.log('Checking existence of avatar file in S3:', avatarFilename)
  const lastUpdated = await checkS3IfFileExists(bucket, avatarFilename)
  console.log(`Avatar file existence for user ${userId}:`, lastUpdated)
  return lastUpdated
}

const updateAvatarCreatedAt = async (): Promise<void> => {
  try {
    const users = await User.find({ avatar_generated_at: { $exists: false } }).lean()
    console.log(`Found ${users.length} users without avatar_generated_at`)
    for (const user of users) {
      console.log(`Processing user ${String(user._id)}...`)
      const lastUpdated = await isThereAvatarS3File(String(user._id))
      if (lastUpdated) {
        await User.findOneAndUpdate(
          { _id: user._id },
          { avatar_generated_at: lastUpdated || new Date() },
          { new: true, runValidators: true }
        )
        console.log(`Updated avatar_generated_at for user ${String(user._id)}`)
      } else {
        console.log(`User ${String(user._id)} does not have an avatar, skipping update`)
      }
    }
    console.log('Avatar created at update process completed.')
  } catch (error) {
    console.error('Error updating avatar_created_at:', error)
  }
}

connect.call(updateAvatarCreatedAt()
  .then(async () => {
    console.log('Update process finished successfully.')
    await updateAvatarCreatedAt()
    process.exit(0)
  })
  .catch((error) => {
    console.error('Update process encountered an error:', error)
    process.exit(1)
  })
)
export default connect
