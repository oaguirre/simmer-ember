import { protect } from '../middleware/auth'
import { router as userRoutes } from './routes/user'
import { router as relationshipRoutes } from './routes/relationship'
import { router as momentRoutes } from './routes/moment'
import { router as learningRoutes } from './routes/learning'
import { router as datingMeetRoutes } from './routes/datingMeet'
import { router as authRoutes } from './routes/auth'
import { router as dbRoutes } from './routes/db'

export const registerRoutes = (app: any) => {
	app.use('/', dbRoutes)
	app.use('/', authRoutes)
	app.use('/api/user', protect, userRoutes)
	app.use('/api/relationship', protect, relationshipRoutes)
	app.use('/api/moment', protect, momentRoutes)
	app.use('/api/moments', protect, momentRoutes)
	app.use('/api/learning', protect, learningRoutes)
	app.use('/api/dating-meet', protect, datingMeetRoutes)
}
