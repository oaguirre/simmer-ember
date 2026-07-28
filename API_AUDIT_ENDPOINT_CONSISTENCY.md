# API Endpoint Data Consistency Audit

**Objective**: Verify that `/api/user/meet` endpoint returns consistent user_a/user_b structure and enforces privacy for the other user.

**Audit Date**: Current Session  
**Status**: ✅ PASS - Data structure is consistent with privacy enforced

---

## 1. Endpoint: `/api/user/meet` (POST)

**Route**: `router.post('/meet', use(user.createMomentWithUser))`  
**Handler**: `src/resources/user/controller.ts:createMomentWithUser`  
**Response Builder**: `buildDateResponse()` in `src/utils/user/moment.ts:229`  

### Request Flow

```
POST /api/user/meet?user_target={ID}&matchingPromptVersion=v3_2&summaryPromptVersion=v4
  ↓
createMomentWithUser()
  ├─ Validate requester (authenticated user) → becomes user_a
  ├─ validateDateTargetUser(user_target) → fetches full user doc as user_b
  ├─ Process AI matching/summary
  ├─ storeMoment(requester, user, ...) → saves moment with user_a=requester, user_b=target
  ├─ buildDateResponse(user, reply, moment, meetingUrls, summary, requester)
  │  └─ Calls mapMomentForResponse(requester, user, moment)
  │     └─ Returns formatted moment with user_a/user_b as PUBLIC DATA ONLY
  └─ res.json(response)
```

---

## 2. Response Structure

### Current Response from `/api/user/meet`

```json
{
  "success": true,
  "message": "Date created successfully with user",
  "data": {
    "reply": "```json\n{...}```",
    "_id": "ObjectId",
    "user_a": {
      "_id": "ObjectId",
      "first_name": "string",
      "avatar_url": "S3 presigned URL",
      "image_url": "S3 presigned URL"
    },
    "user_b": {
      "_id": "ObjectId",
      "first_name": "string",
      "avatar_url": "S3 presigned URL",
      "image_url": "S3 presigned URL"
    },
    "type": "date|personal_moment|coach_moment|chat_conversation",
    "universe": "simmer-world",
    "source": "ai",
    "private_to_a": boolean,
    "when": "ISO 8601 timestamp",
    "summary_a": "string",
    "summary_b": "string",
    "tags": ["string"],
    "items": ["string"],
    
    // Chemistry/compatibility metrics (20+ fields)
    "tone_score": "number string",
    "match_score": "number string",
    "chemistry_signals": "string",
    "conversational_balance": "string",
    "conversation_flow": "string",
    // ... [20+ chemistry/tone/match score fields]
    
    // Image URLs
    "image_urls": ["S3 presigned URLs"],
    
    // Learnings
    "learnings": [
      {
        "_id": "ObjectId",
        "summary": "string",
        "facts": [string],
        "preferences": [string],
        "avoidances": [string],
        "insights": [string],
        "hypotheses": [string],
        "reference_user_ids": [ObjectId],
        "moment_ids": [ObjectId],
        "createdAt": "ISO timestamp",
        "updatedAt": "ISO timestamp"
      }
    ]
  }
}
```

**Key Observation**: user_a and user_b are identically structured with only 4 public fields.

---

## 3. Privacy Analysis

### User Data Exposure

| Field | Data Type | Exposed | Public? | Notes |
|-------|-----------|---------|---------|-------|
| _id | ObjectId | ✅ YES | ✅ PUBLIC | Necessary for client references |
| first_name | String | ✅ YES | ✅ PUBLIC | Basic identity (shown in profiles) |
| avatar_url | S3 URL | ✅ YES | ✅ PUBLIC | Avatar image (already shared) |
| image_url | S3 URL | ✅ YES | ✅ PUBLIC | Profile image (already shared) |
| email | String | ❌ NO | 🔒 PRIVATE | NOT exposed ✅ GOOD |
| phone | String | ❌ NO | 🔒 PRIVATE | NOT exposed ✅ GOOD |
| location | Object | ❌ NO | 🔒 PRIVATE | NOT exposed ✅ GOOD |
| dating_preferences | Object | ❌ NO | 🔒 PRIVATE | NOT exposed ✅ GOOD |
| core_answers | Array | ❌ NO | 🔒 PRIVATE | NOT exposed ✅ GOOD |
| age_range_preference | String | ❌ NO | 🔒 PRIVATE | NOT exposed ✅ GOOD |

### Privacy Enforcement Mechanism

The privacy enforcement happens in **mapMomentForResponse()** (line 121-228 in moment.ts):

```typescript
export const mapMomentForResponse = async (
  userA: UserType, 
  userB: UserType, 
  moment: MomentType | LeanDocument<MomentType> | null
) => {
  // ... setup code ...
  
  return {
    _id: moment?._id,
    user_a: {
      _id: moment?.user_a?._id,
      first_name: ((moment?.user_a as any) || {}).first_name,
      avatar_url: generateS3GetPresignedUrl(getAvatarFilename(String(userA._id))),
      image_url: generateS3GetPresignedUrl(await getProfileImageFilename(userA)),
    },
    user_b: {
      _id: moment?.user_b?._id,
      first_name: ((moment?.user_b as any) || {}).first_name,
      avatar_url: generateS3GetPresignedUrl(getAvatarFilename(String(userB._id))),
      image_url: generateS3GetPresignedUrl(await getProfileImageFilename(userB)),
    },
    // ... moment fields only, no other user data ...
  }
}
```

**Key Privacy Feature**: The function explicitly constructs a new object with ONLY these fields:
- `_id` (necessary for future API calls)
- `first_name` (public profile name)
- `avatar_url` (already publicly accessible)
- `image_url` (already publicly accessible)

This means the full user object returned from `validateDateTargetUser()` (which includes email, phone, preferences, etc.) is **discarded** before sending to the client.

---

## 4. Data Consistency Check

### Comparison: `/api/moment/GET`, `/api/moment/PATCH`, `/api/moment/POST` vs `/api/user/meet`

| Endpoint | Handler | Response Builder | user_a Fields | user_b Fields | Privacy |
|----------|---------|------------------|---------------|---------------|---------|
| GET /api/moment | getMoment | mapMomentForResponse | 4 fields | 4 fields | ✅ ENFORCED |
| PATCH /api/moment | updateMoment | mapMomentForResponse | 4 fields | 4 fields | ✅ ENFORCED |
| POST /api/moment | createMoment | mapMomentForResponse | 4 fields | 4 fields | ✅ ENFORCED |
| POST /api/user/meet | createMomentWithUser | buildDateResponse → mapMomentForResponse | 4 fields | 4 fields | ✅ ENFORCED |

**Conclusion**: ✅ **ALL ENDPOINTS ARE CONSISTENT**

All moment-returning endpoints use the same `mapMomentForResponse()` function, ensuring uniform:
- Response structure
- Field exposure
- Privacy filtering

---

## 5. Recent Improvements (from commit d29aeff)

### Before (Bug):
- `/api/moment` endpoints sometimes returned user_b as **bare ObjectId string** instead of full object
- user_b shape was inconsistent across endpoints

### After (Fix - Commit d29aeff):
- **updateMoment**: Added `.populate('user_b')` + `mapMomentForResponse` before response
- **createMoment**: Added `.populate('user_b')` + `mapMomentForResponse` before response
- **createMomentWithUser**: Already used `mapMomentForResponse` (no additional change needed)
- **All endpoints** now return user_b as consistent fat object: `{_id, first_name, avatar_url, image_url}`

---

## 6. Verification: User Roles in `/api/user/meet`

### User Assignment in Moment Storage

```typescript
// In createMomentWithUser:
const user = await validateDateTargetUser(user_target)  // user_b candidate

// In storeMoment:
user_a: userA,  // The requester (authenticated user)
user_b: userB,  // The target user (other person)

// In buildDateResponse call:
buildDateResponse(user, ..., requester)

// In mapMomentForResponse call:
mapMomentForResponse(requester, user, moment)
// Where: requester → userA parameter (user_a in response)
//        user → userB parameter (user_b in response)
```

**Result**: 
- `user_a` = requester (the authenticated user making the request)
- `user_b` = target user (the other person in the moment)
- Both exposed with identical 4-field structure ✅

---

## 7. No Issues Found

### ✅ Data Consistency: PASS
- All endpoints returning moment data use the same `mapMomentForResponse()` function
- Response structure is uniform across all endpoints
- user_a and user_b always contain: `{_id, first_name, avatar_url, image_url}`

### ✅ Privacy Enforcement: PASS
- Non-requester user (user_b) exposes ONLY public data
- Private fields (email, phone, location, preferences, answers) are NOT included in response
- Privacy filtering happens automatically via explicit field selection in mapMomentForResponse

### ✅ User_B Shape Fix: PASS
- Commit d29aeff successfully ensured user_b is always populated and returned as fat object
- No regression in `/api/user/meet` - it was already using mapMomentForResponse

---

## 8. Recommendations

### Current Status: ✅ READY FOR PRODUCTION

No changes required. The `/api/user/meet` endpoint:
1. Returns consistent user_a/user_b structure
2. Enforces privacy for non-requester user
3. Uses the same response mapping as all other moment endpoints

### Potential Future Enhancements (Optional):

1. **Explicit Privacy Middleware**: Add a middleware layer that validates privacy filtering before response is sent (defense in depth)
2. **Audit Logging**: Log all user data access to moment endpoints for privacy compliance
3. **Dynamic Field Filtering**: Create a `filterUserForRequester(user, requester)` function to make privacy logic more explicit and reusable

---

## Appendix: Code References

### Files Reviewed:
- `src/resources/user/controller.ts` (lines 315-379): createMomentWithUser handler
- `src/resources/moment/controller.ts` (lines 248-365): storeMoment function
- `src/utils/user/moment.ts`:
  - Line 73: validateDateTargetUser()
  - Line 121-228: mapMomentForResponse()
  - Line 229-248: buildDateResponse()
- `src/utils/routes/user.ts` (line 1145): POST /api/user/meet route

### Related Commits:
- d29aeff: Fix user_b shape consistency across all moment endpoints

---

**Audit Complete** ✅
