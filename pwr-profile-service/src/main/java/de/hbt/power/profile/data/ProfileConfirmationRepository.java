package de.hbt.power.profile.data;

import de.hbt.power.profile.model.check.ProfileConfirmation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProfileConfirmationRepository extends JpaRepository<ProfileConfirmation, Long> {

    List<ProfileConfirmation> findByProfileIdOrderByConfirmedAtDesc(Long profileId);
}
