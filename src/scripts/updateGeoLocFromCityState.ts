/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: `.env` })

console.log('Environment:', process.env.NODE_ENV)
console.log('MongoDB Host:', process.env.MONGODB_HOST)
console.log('MongoDB Port:', process.env.MONGODB_PORT)

import connect from '../utils/db'
import { User } from '../resources/user/model'
import { getLatLonFromCityState } from '../utils/user/exploreMatches'
import { get2LetterCodeForState } from '../utils/user/exploreMatches'

const updateGeoLocFromCityState = async (): Promise<void> => {
  try {
    const users = await User.find({ loc_latitude: { $exists: false }, loc_city: { $exists: true }, loc_state: { $exists: true } }).lean() 
    console.log(`Found ${users.length} users with missing loc_latitude but with loc_city and loc_state`)
    for (const user of users) {
      console.log(`Processing user ${String(user._id)}...`)
      const { loc_city, loc_state } = user as any
      const state = loc_state.trim().toLowerCase()
      const city = loc_city.trim().toLowerCase()
      const latLon = getLatLonFromCityState(city, state.length <=2 ? state : get2LetterCodeForState('US', loc_state.toUpperCase()) || '')
      console.log('Derived lat/lon from city/state:', latLon, city, state)
      if (!latLon) {
        console.log(`Skipping user ${String(user._id)} due to missing lat/lon`)
        continue
      }
      await User.findOneAndUpdate(
        { _id: user._id },
        { loc_latitude: latLon.latitude, loc_longitude: latLon.longitude },
        { new: true, runValidators: true }
      )
      console.log(`Updated geo location for user ${String(user._id)}`)
    }
    console.log('Geo location update process completed.')
  } catch (error) {
    console.error('Error updating geo location:', error)
  }
}

connect.call(updateGeoLocFromCityState()
  .then(async () => {
    console.log('Update process finished successfully.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Update process encountered an error:', error)
    process.exit(1)
  })
)
