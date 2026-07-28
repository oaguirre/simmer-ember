import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import axios from 'axios'
import { defaultQuestions } from '../resources/user/model'
import type { UserType } from '../resources/user/model'
import FormData from 'form-data'
import { getLatLonFromCityState } from '../utils/user/exploreMatches'

const DEFAULT_QUESTIONS = defaultQuestions

// Adjust the CSV path and API endpoint as needed
const csvFilePath = path.resolve(__dirname, './db/simmer-testing-profiles-closed.csv')
const serverUrl = 'http://localhost:4000'
const profilePicsDir = 'profile-pics-prod'

const getDefaultPassword = () => '12345'
const getUsername = (userData: Partial<UserType>) => {
	return (userData.first_name ? userData.first_name.toLowerCase().charAt(0) : '') + (userData.last_name ? userData.last_name.toLowerCase() : '')
}

const signupUser = async (userData: Partial<UserType>) => {
	const username = getUsername(userData)
	const password = getDefaultPassword()
	try {
		const response = await axios.post(
			`${serverUrl}/signup`,
			{
				username,
				password,
				first_name: userData.first_name,
				last_name: userData.last_name,
				email: `${username}@test.com`,
				is_test_user: true,
				gender: userData.gender,
				genders_to_date: userData.genders_to_date || ['prefer_not_to_say'],
				have_kids: userData.have_kids || 'unanswered',
				want_kids: userData.want_kids || 'unanswered',
				smoking: userData.smoking || 'unanswered',
				cannabis: userData.cannabis || 'unanswered',
				relationship_structure: userData.relationship_structure || 'unanswered',
				pets: userData.pets || 'unanswered',
				faith_importance: userData.faith_importance || 'unanswered',
				vaccination_stance: userData.vaccination_stance || 'unanswered',
				deal_break_lightning: userData.deal_break_lightning,
				loc_latitude: userData.loc_latitude || 0,
				loc_longitude: userData.loc_longitude || 0,
				loc_address: userData.loc_address || '',
				loc_city: userData.loc_city || '',
				loc_state: userData.loc_state || '',
				loc_country: userData.loc_country || '',
				loc_postal_code: userData.loc_postal_code || '',
				drinking: userData.drinking || 'unanswered',
				political_view: userData.political_view || 'unanswered',
				about: userData.about || '',
				languages: userData.languages || ['english'],
				phone: userData.phone || '',
				high_priority_values: userData.high_priority_values,
				date_of_birth: userData.date_of_birth,
				core_questions: DEFAULT_QUESTIONS,
				core_answers: userData.core_answers || [],
			},
			{ headers: { 'Content-Type': 'application/json' } },
		)
		return response.data
	} catch (error) {
		console.error('Error signing up user:', (error as Error).message)
		return null
	}
}

const signinUser = async (user: Partial<UserType>) => {
	try {
		const username = getUsername(user)
		const password = getDefaultPassword()
		const response = await axios.post(`${serverUrl}/signin`, { username, password }, { headers: { 'Content-Type': 'application/json' } })
		return response.data
	} catch (error) {
		console.error('Error signing in user:', (error as Error).message)
		return null
	}
}

const getImageBasedOnGender = (user: Partial<UserType>) => {
	let maleFemalePicture = 'male'
	switch (user.gender?.toLowerCase()) {
		case 'male':
			maleFemalePicture = 'male'
			break
		case 'female':
			maleFemalePicture = 'female'
			break
		default:
			maleFemalePicture = Math.random() < 0.5 ? 'male' : 'female'
			break
	}
	const numFilesPerGender = 20
	const postfix = Math.trunc(1 + Math.random() * (numFilesPerGender - 1))
	const { first_name = 'test', last_name = 'user' } = user
	const imageFilesOptions = [
		`${profilePicsDir}/${first_name}${last_name}.png`,
		`${profilePicsDir}/${first_name}${last_name}.jpg`,
		`${profilePicsDir}/${maleFemalePicture}-${postfix}.jpg`,
	]
	for (const option of imageFilesOptions) {
		const imagePath = path.resolve(__dirname, `./db/${option}`)
		if (fs.existsSync(imagePath)) {
			return option
		}
	}
	return `${profilePicsDir}/${maleFemalePicture}-${postfix}.jpg`
}

const uploadProfileImage = async (token, user: Partial<UserType>) => {
	try {
		const imagePath = getImageBasedOnGender(user)
		console.log('Uploading profile image for user fist_name:', user.first_name, 'last_name:', user.last_name, 'id:', user._id, 'gender:', user.gender, 'imagePath:', imagePath)
		const imageBuffer = fs.readFileSync(path.resolve(__dirname, `./db/${imagePath}`))
		const formData = new FormData()
		formData.append('image', imageBuffer, { filename: path.basename(imagePath), contentType: 'image/jpeg' })
		console.log('Uploading profile image:', imagePath, 'for user fist_name:', user.first_name, 'last_name:', user.last_name, 'id:', user._id)

		const response = await axios.post(`${serverUrl}/api/user/image?skip_avatar=false`, formData, {
			headers: {
				'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
				'Content-Length': formData.getLengthSync().toString(),
				Authorization: `Bearer ${token}`,
				Accept: '*/*',
			},
		})
		return response.data
	} catch (error) {
		console.error('Error uploading profile image:', (error as Error).message)
		throw error
	}
}

const updateProfileData = async (token, user: Partial<UserType>) => {
	try {
		console.log('Updating profile data for user fist_name:', user.first_name, 'last_name:', user.last_name, 'gender:', user.gender, 'genders_to_date:', user.genders_to_date)
		const response = await axios.put(
			`${serverUrl}/api/user`,
			{
				gender: user.gender,
				genders_to_date: user.genders_to_date,
				want_kids: user.want_kids || 'unanswered',
				have_kids: user.have_kids || 'unanswered',
				pets: user.pets || 'unanswered',
				smoking: user.smoking || 'unanswered',
				cannabis: user.cannabis || 'unanswered',
				drinking: user.drinking || 'unanswered',
				date_of_birth: user.date_of_birth,
				high_priority_values: user.high_priority_values || [],
				deal_break_lightning: user.deal_break_lightning || [],
				core_questions: DEFAULT_QUESTIONS,
				core_answers: user.core_answers || [],
				loc_city: user.loc_city,
				loc_state: user.loc_state,
				loc_country: user.loc_country,
				loc_latitude: user.loc_latitude,
				loc_longitude: user.loc_longitude,
			},
			{
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
			},
		)
		console.log('UPDATED profile data for user fist_name:', user.first_name, 'last_name:', user.last_name)
		return response.data
	} catch (error) {
		console.error('Error updating profile data:', (error as Error).message)
		throw error
	}
}

const processCSV = async () => {
	const users: any[] = []

	fs
		.createReadStream(csvFilePath)
		.pipe(csv())
		.on('data', row => {
			const firstname = row.name.split(' ')[0]
			const lastname = row.name.split(' ')[1] || 'Test'
			const { latitude, longitude } = getLatLonFromCityState(row.city, row.state) || { latitude: null, longitude: null }
			const user = {
				first_name: firstname,
				last_name: lastname,
				is_test_user: true,
				gender: row.gender?.toLowerCase() || 'prefer_not_to_say',
				genders_to_date: row.preferred_gender.split('|').map((g: string) => g.toLowerCase()),
				core_questio_ns: DEFAULT_QUESTIONS,
				core_answers: [row.q1, row.q2, row.q3, row.q4, row.q5],
				smoking: row.smoking || 'unanswered',
				drinking: row.drinking || 'unanswered',
				pets: row.pets || 'unanswered',
				want_kids: row.want_kids || 'unanswered',
				have_kids: row.have_kids || 'unanswered',
				deal_break_lightning: row.deal_break_lightning ? row.deal_break_lightning.split(',').map((i: string) => i.toLowerCase().trim()) : [],
				high_priority_values: row.high_priority_values ? row.high_priority_values.split(',').map((i: string) => i.toLowerCase().trim()) : [],
				date_of_birth: new Date(row.date_of_birth) || '1990-01-01',
				loc_city: row.city || '',
				loc_state: row.state || '',
				loc_country: row.country || 'US',
				loc_latitude: latitude,
				loc_longitude: longitude,
				is_admin: false,
				is_banned: false,
				plan: 'free',
				email: `${row.name}@test.com`,
				phone: '',
			}
			users.push(user)
		})
		.on('end', async () => {
			console.log(`Read ${users.length} users from CSV.`)
			for (const user of users) {
				try {
					const response = (await signupUser(user)) || (await signinUser(user))
					const token = response.token
					const userData = response.data as Partial<UserType>
					console.log('Signed up/signed in user:', user.first_name, user.gender, token)
					await updateProfileData(token, user)
					if (!userData.avatar_generated_at) {
						await uploadProfileImage(token, response.data as Partial<UserType>)
					}
					console.log(`Created user: ${user.first_name} (ID: ${response.data._id})`)
				} catch (error) {
					console.error(`Failed to create user ${user.first_name}:`, (error as Error).message)
				}
			}
			console.log('Finished populating users.')
		})
}

processCSV().catch(error => {
	console.error('Error processing CSV:', error)
})
